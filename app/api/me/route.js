import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { getSql } from '@/lib/db';
import {
  hashPassword,
  passwordNeedsUpgrade,
  validateNewPassword,
  verifyPassword,
} from '@/lib/password';
import { sessionCookie, signSession } from '@/lib/session';
import { ApiError, requestJson, withApi } from '@/lib/http';
import {
  normalizeEmail,
  normalizeUsername,
  oneOf,
  optionalString,
} from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = withApi(async () => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  return NextResponse.json({ user: session }, { headers: { 'Cache-Control': 'no-store' } });
});

// Self-service profile updates. Every signed-in user may change their own
// display name, email, username and password; role and active flags are
// rejected here so they stay behind superadmin-only endpoints.
//
// Any change to an identity field (username, email, password) requires the
// current password, so a borrowed or stolen session cannot lock the real
// owner out. Each of those changes also bumps session_version, which
// invalidates every other session for that user.
export const PUT = withApi(async request => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  const body = await requestJson(request);

  if ('role' in body || 'role_id' in body || 'active' in body) {
    throw new ApiError(403, 'Role changes require superadmin access');
  }

  const sql = getSql();
  const current = await sql`
    SELECT id::text, username, email, password_hash
    FROM users
    WHERE id = ${session.id} AND archived_at IS NULL
  `;
  const existing = current[0];
  if (!existing) throw new ApiError(404, 'User not found');

  const hasUsername = Object.prototype.hasOwnProperty.call(body, 'username');
  const hasEmail = Object.prototype.hasOwnProperty.call(body, 'email');
  const wantsPassword = typeof body.password === 'string' && body.password.length > 0;

  const username = hasUsername ? normalizeUsername(body.username) : existing.username;
  const email = hasEmail ? normalizeEmail(body.email) : existing.email;
  const name = 'name' in body ? optionalString(body.name, 'Name', { min: 1, max: 150 }) : null;
  const theme = 'theme' in body ? oneOf(body.theme, 'Theme', ['light', 'dark', 'auto']) : null;

  // Which stored values actually change, ignoring no-op writes.
  const usernameChanged = hasUsername && username !== existing.username;
  const emailChanged = hasEmail && (email ?? '') !== (existing.email ?? '');
  const identityChanged = usernameChanged || emailChanged || wantsPassword;

  if (identityChanged) {
    const currentPassword = body.current_password;
    if (typeof currentPassword !== 'string' || !currentPassword) {
      throw new ApiError(400, 'Confirm your current password to change these details', {
        current_password: 'Enter your current password',
      });
    }
    const ok = await verifyPassword(currentPassword, existing.password_hash);
    if (!ok) {
      throw new ApiError(403, 'Your current password was not correct', {
        current_password: 'That password is not correct',
      });
    }
  }

  if (emailChanged) {
    const taken = await sql`
      SELECT id::text FROM users
      WHERE LOWER(email) = ${email} AND id <> ${session.id} AND archived_at IS NULL
    `;
    if (taken.length) {
      throw new ApiError(409, 'That email address is already in use', {
        email: 'Another account already uses this address',
      });
    }
  }

  if (usernameChanged) {
    const taken = await sql`
      SELECT id::text FROM users WHERE username = ${username} AND id <> ${session.id}
    `;
    if (taken.length) {
      throw new ApiError(409, 'That username is taken', {
        username: 'Someone else already uses this username',
      });
    }
  }

  const password = wantsPassword ? validateNewPassword(body.password) : null;
  if (password && password === body.current_password) {
    throw new ApiError(400, 'Choose a password you have not used here before', {
      password: 'New password must be different from your current one',
    });
  }
  const passwordHash = password ? await hashPassword(password) : null;

  const updatedUsers = await sql`
    UPDATE users
    SET name = COALESCE(${name}, name),
        username = ${username},
        email = CASE WHEN ${hasEmail} THEN ${email} ELSE email END,
        theme = COALESCE(${theme}, theme),
        password_hash = COALESCE(${passwordHash}, password_hash),
        session_version = session_version + CASE
          WHEN ${identityChanged} THEN 1 ELSE 0
        END
    WHERE id = ${session.id} AND archived_at IS NULL
    RETURNING id::text, username, email, name, role, session_version
  `;
  const updated = updatedUsers[0];
  if (!updated) throw new ApiError(404, 'User not found');

  // Transparently upgrade a weaker stored hash while we already know the
  // current password in plaintext.
  if (passwordNeedsUpgrade(existing.password_hash) && !passwordHash) {
    await sql`UPDATE users SET password_hash = ${await hashPassword(body.current_password)} WHERE id = ${session.id}`;
  }

  const renewed = {
    ...session,
    username: updated.username,
    email: updated.email ?? null,
    name: updated.name ?? null,
    sessionVersion: Number(updated.session_version),
  };
  const token = await signSession(renewed);
  const response = NextResponse.json({ ok: true, user: renewed });
  response.cookies.set(sessionCookie(token));
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
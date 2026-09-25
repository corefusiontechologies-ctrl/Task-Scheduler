import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { getSql } from '@/lib/db';
import { hashPassword, validateNewPassword } from '@/lib/password';
import { sessionCookie, signSession } from '@/lib/session';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { normalizeUsername, oneOf, optionalString } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = withApi(async () => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  return NextResponse.json({ user: session }, { headers: { 'Cache-Control': 'no-store' } });
});

export const PUT = withApi(async request => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  const body = await requestJson(request);
  if ('role' in body || 'role_id' in body || 'active' in body) {
    throw new ApiError(403, 'Role changes require superadmin access');
  }
  const username = 'username' in body ? normalizeUsername(body.username) : session.username;
  const name = 'name' in body ? optionalString(body.name, 'Name', { min: 1, max: 150 }) : null;
  const theme = 'theme' in body ? oneOf(body.theme, 'Theme', ['light', 'dark', 'auto']) : null;
  const password = body.password ? validateNewPassword(body.password) : null;
  const passwordHash = password ? await hashPassword(password) : null;
  const sql = getSql();
  const updatedUsers = await sql`
    UPDATE users
    SET name = COALESCE(${name}, name),
        username = ${username},
        theme = COALESCE(${theme}, theme),
        password_hash = COALESCE(${passwordHash}, password_hash),
        session_version = session_version + CASE
          WHEN username IS DISTINCT FROM ${username} OR ${passwordHash}::text IS NOT NULL THEN 1 ELSE 0
        END
    WHERE id = ${session.id} AND archived_at IS NULL
    RETURNING id::text, username, role, session_version
  `;
  const updated = updatedUsers[0];
  if (!updated) throw new ApiError(404, 'User not found');
  const renewed = {
    ...session,
    username: updated.username,
    sessionVersion: Number(updated.session_version),
  };
  const token = await signSession(renewed);
  const response = NextResponse.json({ ok: true, user: renewed });
  response.cookies.set(sessionCookie(token));
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

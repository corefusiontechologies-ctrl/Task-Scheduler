import { NextResponse } from 'next/server';
import { getRateLimitState, recordRateLimitAttempt, serializeRateLimitHeaders } from '@/lib/rateLimit';
import { getSql, DatabaseConfigurationError } from '@/lib/db';
import { hashPassword, passwordNeedsUpgrade, verifyPassword } from '@/lib/password';
import { sessionCookie, signSession } from '@/lib/session';

export async function POST(request) {
  let headers = {};
  const limit = await getRateLimitState(request, 8, 15 * 60 * 1000);
  headers = serializeRateLimitHeaders(limit);
  if (limit.blocked) {
    return NextResponse.json({ error: 'Too many login attempts. Please try again later.' }, { status: 429, headers });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
      await recordRateLimitAttempt(request, '', false);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401, headers });
    }
    const username = body.username.trim();
    if (!username || username.length > 150 || body.password.length > 1024) {
      await recordRateLimitAttempt(request, username, false);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401, headers });
    }

    const sql = getSql();
    const users = await sql`
      SELECT id::text, username, password_hash, role, session_version, archived_at
      FROM users
      WHERE lower(username) = lower(${username})
      LIMIT 1
    `;
    const user = users[0];
    const valid = user && !user.archived_at && await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      await recordRateLimitAttempt(request, username, false);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401, headers });
    }
    await recordRateLimitAttempt(request, username, true);

    if (passwordNeedsUpgrade(user.password_hash)) {
      const upgradedHash = await hashPassword(body.password);
      await sql`UPDATE users SET password_hash = ${upgradedHash} WHERE id = ${user.id}`;
    }

    const permissionRows = await sql`
      SELECT p.name
      FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN users u ON u.role_id = rp.role_id
      WHERE u.id = ${user.id}
      ORDER BY p.name
    `;
    const sessionUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: permissionRows.map(row => row.name),
      session_version: user.session_version,
    };
    const token = await signSession(sessionUser);
    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: permissionRows.map(row => row.name),
      },
    });
    response.cookies.set(sessionCookie(token));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      return NextResponse.json({ error: 'Database is not configured' }, { status: 503, headers });
    }
    console.error('Login failed', error);
    return NextResponse.json({ error: 'Login service is temporarily unavailable' }, { status: 503, headers });
  }
}

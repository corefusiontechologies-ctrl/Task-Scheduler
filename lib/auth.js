import { cookies } from 'next/headers';
import { getSql } from './db';
import { decodeSession, parseCookieHeader } from './session';

export async function getSession() {
  const store = await cookies();
  return decodeSession(store.get('session')?.value);
}

export async function getSessionFromRequest(request) {
  return decodeSession(parseCookieHeader(request.headers.get('cookie')).session);
}

export async function getFreshSession() {
  const session = await getSession();
  if (!session) return null;
  const sql = getSql();
  const users = await sql`
    SELECT u.id::text, u.username, u.role, u.session_version,
      COALESCE(ARRAY(
        SELECT p.name
        FROM permissions p
        JOIN role_permissions rp ON rp.permission_id = p.id
        WHERE rp.role_id = u.role_id
        ORDER BY p.name
      ), ARRAY[]::varchar[]) AS permissions
    FROM users u
    WHERE u.id::text = ${session.id}
      AND u.archived_at IS NULL
      AND u.session_version = ${session.sessionVersion}
  `;
  const user = users[0];
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    permissions: user.permissions || [],
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    sessionVersion: Number(user.session_version || 0),
  };
}

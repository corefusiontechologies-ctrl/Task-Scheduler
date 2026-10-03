import { cookies } from 'next/headers';
import { getSql } from './db';
import { decodeSession, parseCookieHeader } from './session';
import { resolvePermissions } from './permissions';

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
    SELECT u.id::text, u.username, u.email, u.name, u.role, u.session_version,
      COALESCE(ARRAY(
        SELECT p.name
        FROM permissions p
        JOIN role_permissions rp ON rp.permission_id = p.id
        WHERE rp.role_id = u.role_id
        ORDER BY p.name
      ), ARRAY[]::varchar[]) AS role_permissions,
      COALESCE(ARRAY(
        SELECT p.name
        FROM user_permission_overrides upo
        JOIN permissions p ON p.id = upo.permission_id
        WHERE upo.user_id = u.id AND upo.effect = 'allow'
        ORDER BY p.name
      ), ARRAY[]::varchar[]) AS allowed_permissions,
      COALESCE(ARRAY(
        SELECT p.name
        FROM user_permission_overrides upo
        JOIN permissions p ON p.id = upo.permission_id
        WHERE upo.user_id = u.id AND upo.effect = 'deny'
        ORDER BY p.name
      ), ARRAY[]::varchar[]) AS denied_permissions
    FROM users u
    WHERE u.id::text = ${session.id}
      AND u.archived_at IS NULL
      AND u.session_version = ${session.sessionVersion}
  `;
  const user = users[0];
  if (!user) return null;
  // Permissions are recomputed from the database on every authenticated
  // request rather than trusted from the cookie, so an override takes effect
  // immediately and revoking a permission cannot wait for the session to
  // expire. Deny overrides beat allow overrides.
  const permissions = resolvePermissions(
    user.role_permissions || [],
    user.allowed_permissions || [],
    user.denied_permissions || [],
  );
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    name: user.name ?? null,
    role: user.role,
    permissions,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    sessionVersion: Number(user.session_version || 0),
  };
}

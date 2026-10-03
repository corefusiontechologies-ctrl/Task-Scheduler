import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { db, getSql } from '@/lib/db';
import { hashPassword, validateNewPassword } from '@/lib/password';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { resolvePermissions } from '@/lib/permissions';
import { normalizeUsername, oneOf, optionalString, requiredBoolean, requiredId, requiredString } from '@/lib/validation';

// `role_permissions` is what the role grants; the two override arrays are what
// this individual has been given extra or had taken away. The admin UI needs
// all three to show role baseline vs actual, so they are returned separately
// alongside the resolved `permissions` list.
const USER_FIELDS = `
  u.id::text, u.name, u.username, u.theme, u.role, u.role_id::text,
  u.active, u.archived_at, u.session_version,
  u.last_login, u.last_login_ip,
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
  ), ARRAY[]::varchar[]) AS denied_permissions,
  COALESCE(ARRAY(
    SELECT uc.category_id::text
    FROM user_categories uc
    WHERE uc.user_id = u.id
    ORDER BY uc.category_id
  ), ARRAY[]::varchar[]) AS user_categories
`;

function decorate(user) {
  const rolePermissions = user.role_permissions || [];
  const allowedPermissions = user.allowed_permissions || [];
  const deniedPermissions = user.denied_permissions || [];
  return {
    ...user,
    rolePermissions,
    allowedPermissions,
    deniedPermissions,
    userCategories: user.user_categories || [],
    hasOverrides: allowedPermissions.length > 0 || deniedPermissions.length > 0 || (user.user_categories || []).length > 0,
    permissions: resolvePermissions(rolePermissions, allowedPermissions, deniedPermissions),
  };
}

export const GET = withApi(async () => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
  const sql = getSql();
  const users = await sql(`
    SELECT ${USER_FIELDS}
    FROM users u
    WHERE u.archived_at IS NULL
    ORDER BY u.username
  `);
  return NextResponse.json(
    { users: users.map(decorate) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

export const POST = withApi(async request => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
  const body = await requestJson(request);
  const username = normalizeUsername(body.username);
  const name = optionalString(body.name, 'Name', { min: 1, max: 150 });
  const password = validateNewPassword(body.password);
  const roleId = requiredId(body.role_id, 'Role');
  const theme = body.theme === undefined ? 'auto' : oneOf(body.theme, 'Theme', ['light', 'dark', 'auto']);
  const passwordHash = await hashPassword(password);
  const sql = getSql();
  const roles = await sql`SELECT name FROM roles WHERE id = ${roleId} AND archived_at IS NULL LIMIT 1`;
  if (!roles[0]) throw new ApiError(400, 'Role does not exist');
  // db.transaction returns one result-set per statement, so this destructures
  // to the row array; index [0] is the inserted row. Spreading the result-set
  // directly would serialise as {"0": {...}} with no id or username.
  const [createdRows] = await db.transaction(txn => [
    txn`
      INSERT INTO users (name, username, password_hash, role, role_id, theme, active)
      VALUES (${name}, ${username}, ${passwordHash}, ${roles[0].name}, ${roleId}, ${theme}, true)
      RETURNING id::text, name, username, theme, role, role_id::text, active, archived_at, session_version
    `,
  ]);
  const created = createdRows[0];
  if (!created) throw new ApiError(500, 'The account could not be created');
  return NextResponse.json({ user: { ...created, permissions: [] } }, { status: 201 });
});


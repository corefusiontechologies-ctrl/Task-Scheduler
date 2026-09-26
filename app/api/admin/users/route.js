import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { db, getSql } from '@/lib/db';
import { hashPassword, validateNewPassword } from '@/lib/password';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { normalizeUsername, oneOf, optionalString, requiredBoolean, requiredId, requiredString } from '@/lib/validation';

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
  ), ARRAY[]::varchar[]) AS permissions
`;

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
  return NextResponse.json({ users }, { headers: { 'Cache-Control': 'no-store' } });
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
  const [created] = await db.transaction(txn => [
    txn`
      INSERT INTO users (name, username, password_hash, role, role_id, theme, active)
      VALUES (${name}, ${username}, ${passwordHash}, ${roles[0].name}, ${roleId}, ${theme}, true)
      RETURNING id::text, name, username, theme, role, role_id::text, active, archived_at, session_version
    `,
  ]);
  return NextResponse.json({ user: { ...created, permissions: [] } }, { status: 201 });
});


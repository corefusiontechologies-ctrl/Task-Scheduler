import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { db, getSql } from '@/lib/db';
import { hashPassword, validateNewPassword } from '@/lib/password';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { normalizeUsername, oneOf, optionalString, requiredBoolean, requiredId } from '@/lib/validation';

export const PUT = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  const { id } = await params;
  const userId = requiredId(id, 'User ID');
  const isSelf = String(session.id) === userId;
  if (session.role !== 'superadmin' && !isSelf) throw new ApiError(403, 'Access denied');
  const body = await requestJson(request);
  const username = normalizeUsername(body.username);
  const name = optionalString(body.name, 'Name', { min: 1, max: 150 });
  const roleId = requiredId(body.role_id, 'Role');
  const active = requiredBoolean(body.active, 'Active');
  const theme = oneOf(body.theme, 'Theme', ['light', 'dark', 'auto']);
  const password = body.password ? validateNewPassword(body.password) : null;
  const passwordHash = password ? await hashPassword(password) : null;
  if (isSelf && !active) throw new ApiError(400, 'You cannot deactivate your own account');
  const sql = getSql();
  const roles = await sql`SELECT name FROM roles WHERE id = ${roleId} AND archived_at IS NULL LIMIT 1`;
  if (!roles[0]) throw new ApiError(400, 'Role does not exist');
  const currentRows = await sql`SELECT username, role, role_id::text FROM users WHERE id = ${userId} AND archived_at IS NULL LIMIT 1`;
  const current = currentRows[0];
  if (!current) throw new ApiError(404, 'User not found');
  if (isSelf && String(current.role_id) !== String(roleId)) {
    throw new ApiError(400, 'You cannot change your own role');
  }
  const removesLastSuperadmin = current.role === 'superadmin' && (roles[0].name !== 'superadmin' || !active);
  const [updated] = await db.transaction(txn => [
    txn`
      UPDATE users u
      SET name = ${name},
          username = ${username},
          role = ${roles[0].name},
          role_id = ${roleId},
          theme = ${theme},
          active = ${active},
          archived_at = CASE WHEN ${active} THEN NULL ELSE NOW() END,
          session_version = session_version + CASE
            WHEN username IS DISTINCT FROM ${username}
              OR role_id IS DISTINCT FROM ${roleId}
              OR NOT ${active}
              OR ${passwordHash}::text IS NOT NULL
            THEN 1 ELSE 0
          END
      WHERE id = ${userId}
        AND (
          ${!removesLastSuperadmin}
          OR EXISTS (
            SELECT 1 FROM users other
            WHERE other.id <> u.id
              AND other.role = 'superadmin'
              AND other.active = true
              AND other.archived_at IS NULL
          )
        )
      RETURNING id::text, username, role, role_id::text, session_version
    `,
  ]);
  if (!updated) throw new ApiError(409, 'The only active superadmin cannot be removed');
  return NextResponse.json({
    ok: true,
    sensitiveChange: current.username !== username || String(current.role_id) !== String(roleId) || !!passwordHash,
  });
});

export const DELETE = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
  const { id } = await params;
  const userId = requiredId(id, 'User ID');
  const sql = getSql();
  const updated = await sql`
    UPDATE users u
    SET active = false, archived_at = NOW(), session_version = session_version + 1
    WHERE id = ${userId}
      AND archived_at IS NULL
      AND (
        role <> 'superadmin'
        OR EXISTS (
          SELECT 1 FROM users other
          WHERE other.id <> u.id
            AND other.role = 'superadmin'
            AND other.active = true
            AND other.archived_at IS NULL
        )
      )
    RETURNING id::text
  `;
  if (!updated[0]) {
    const exists = await sql`SELECT id FROM users WHERE id = ${userId} AND archived_at IS NULL`;
    if (!exists[0]) throw new ApiError(404, 'User not found');
    throw new ApiError(409, 'The only active superadmin cannot be archived');
  }
  return NextResponse.json({ ok: true });
});

import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { can, canViewAllTasks } from '@/lib/access';
import { genToken, getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { optionalString, requiredString } from '@/lib/validation';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function hasVisibleTask(session, clientName) {
  const sql = getSql();
  if (canViewAllTasks(session)) {
    const rows = await sql`
      SELECT 1 FROM tasks
      WHERE client_name = ${clientName} AND archived_at IS NULL
      LIMIT 1
    `;
    return rows.length > 0;
  }
  const rows = await sql`
    SELECT 1
    FROM tasks task
    WHERE task.client_name = ${clientName}
      AND task.archived_at IS NULL
      AND (
        task.assigned_to IN (
          SELECT id FROM team_members WHERE user_id = ${session.id} AND archived_at IS NULL
        )
        OR task.category_id IN (
          SELECT rc.category_id FROM role_categories rc
          JOIN users u ON u.role_id = rc.role_id WHERE u.id = ${session.id}
        )
      )
    LIMIT 1
  `;
  return rows.length > 0;
}

export const POST = withApi(async request => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'view_client_links')) throw new ApiError(403, 'Client link access is required');
  const body = await requestJson(request);
  const clientName = requiredString(body.client_name, 'Client name', { min: 1, max: 255 });
  const clientEmail = optionalString(body.client_email, 'Client email', { min: 3, max: 254, pattern: EMAIL_PATTERN }) || '';
  if (!(await hasVisibleTask(session, clientName))) throw new ApiError(404, 'No visible tasks exist for this client');
  const sql = getSql();
  const token = genToken();
  const inserted = await sql`
    INSERT INTO client_portals (name, client_name, client_email, token, created_by)
    VALUES (${clientName}, ${clientName}, ${clientEmail}, ${token}, ${session.username})
    ON CONFLICT DO NOTHING
    RETURNING token
  `;
  if (inserted[0]) return NextResponse.json({ token: inserted[0].token }, { status: 201 });
  const existing = await sql`
    UPDATE client_portals
    SET client_email = COALESCE(NULLIF(${clientEmail}, ''), client_email)
    WHERE lower(name) = lower(${clientName}) AND archived_at IS NULL
    RETURNING token
  `;
  if (!existing[0]) throw new ApiError(409, 'Unable to create client portal');
  return NextResponse.json({ token: existing[0].token });
});

import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { can, canManageInvoices, canViewAllTasks } from '@/lib/access';
import { getSql } from '@/lib/db';
import { ApiError, withApi } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = withApi(async () => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'view_activity')) throw new ApiError(403, 'Activity access is required');
  const sql = getSql();
  let taskActivity = [];
  if (can(session, 'view_tasks')) {
    taskActivity = canViewAllTasks(session)
      ? await sql`
          SELECT ta.id::text, ta.action, ta.details, ta.actor, ta.username, ta.created_at,
            t.id::text AS ref_id, t.title, t.client_name
          FROM task_activity ta
          JOIN tasks t ON t.id = ta.task_id
          WHERE t.archived_at IS NULL
          ORDER BY ta.created_at DESC, ta.id DESC
          LIMIT 40
        `
      : await sql`
          SELECT ta.id::text, ta.action, ta.details, ta.actor, ta.username, ta.created_at,
            t.id::text AS ref_id, t.title, t.client_name
          FROM task_activity ta
          JOIN tasks t ON t.id = ta.task_id
          WHERE t.archived_at IS NULL
            AND (
              t.assigned_to IN (
                SELECT id FROM team_members WHERE user_id = ${session.id} AND archived_at IS NULL
              )
              OR t.category_id IN (
                SELECT rc.category_id FROM role_categories rc
                JOIN users u ON u.role_id = rc.role_id WHERE u.id = ${session.id}
              )
            )
          ORDER BY ta.created_at DESC, ta.id DESC
          LIMIT 40
        `;
  }

  let invoiceActivity = [];
  if (can(session, 'view_invoices')) {
    invoiceActivity = canManageInvoices(session)
      ? await sql`
          SELECT ta.id::text, ta.action, ta.details, ta.actor, ta.username, ta.created_at,
            i.id::text AS ref_id, i.invoice_number AS title, i.client_name
          FROM task_activity ta
          JOIN invoices i ON i.id::text = NULLIF(ta.details, '')::jsonb->>'invoice_id'
          WHERE i.archived_at IS NULL
          ORDER BY ta.created_at DESC, ta.id DESC
          LIMIT 40
        `
      : await sql`
          SELECT ta.id::text, ta.action, ta.details, ta.actor, ta.username, ta.created_at,
            i.id::text AS ref_id, i.invoice_number AS title, i.client_name
          FROM task_activity ta
          JOIN invoices i ON i.id::text = NULLIF(ta.details, '')::jsonb->>'invoice_id'
          WHERE i.archived_at IS NULL AND i.created_by_id = ${session.id}
          ORDER BY ta.created_at DESC, ta.id DESC
          LIMIT 40
        `;
  }

  const combined = [
    ...taskActivity.map(row => ({
      type: 'task',
      id: `t${row.id}`,
      action: row.action,
      message: `${row.actor || row.username} ${row.action}${row.details ? `: ${row.details}` : ''}`,
      created_at: row.created_at,
      refId: row.ref_id,
      title: row.title,
      client_name: row.client_name,
    })),
    ...invoiceActivity.map(row => ({
      type: 'invoice',
      id: `i${row.id}`,
      action: row.action,
      message: `${row.actor || row.username} ${row.action.replaceAll('_', ' ')}${row.details ? `: ${row.details}` : ''}`,
      created_at: row.created_at,
      refId: row.ref_id,
      title: row.title,
      client_name: row.client_name,
    })),
  ].sort((left, right) => new Date(right.created_at) - new Date(left.created_at)).slice(0, 50);

  return NextResponse.json(combined, { headers: { 'Cache-Control': 'no-store' } });
});

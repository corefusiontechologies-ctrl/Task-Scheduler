import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { can, canViewAllTasks, getUserMemberId } from '@/lib/access';
import { getSql } from '@/lib/db';
import { ApiError, withApi } from '@/lib/http';

export const GET = withApi(async (request, { params }) => {
  void request;
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'view_tasks')) throw new ApiError(403, 'Task access is required');
  const { id } = await params;
  const sql = getSql();
  const taskRows = await sql`SELECT id::text, assigned_to::text, category_id::text FROM tasks WHERE id = ${id} AND archived_at IS NULL`;
  const task = taskRows[0];
  if (!task) throw new ApiError(404, 'Task not found');
  if (!canViewAllTasks(session)) {
    const memberId = await getUserMemberId(session);
    const [access] = await sql`
      SELECT 1 AS allowed
      WHERE ${memberId || 0}::integer = ${task.assigned_to || 0}::integer
        OR ${task.category_id || 0}::integer IN (
          SELECT rc.category_id
          FROM role_categories rc
          JOIN users u ON u.role_id = rc.role_id
          WHERE u.id = ${session.id}
        )
    `;
    if (!access) throw new ApiError(404, 'Task not found');
  }
  const activity = await sql`
    SELECT id::text, user_id::text, username, actor, action, details, created_at
    FROM task_activity
    WHERE task_id = ${id}
    ORDER BY created_at DESC, id DESC
    LIMIT 200
  `;
  return NextResponse.json(activity, { headers: { 'Cache-Control': 'no-store', 'X-Total-Count': String(activity.length) } });
});

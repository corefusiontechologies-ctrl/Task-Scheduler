import { getSql } from './db';

export function isSuperAdmin(session) {
  return session?.role === 'superadmin';
}

export function can(session, permission) {
  return isSuperAdmin(session) || !!session?.permissions?.includes(permission);
}

export function canViewAllTasks(session) {
  return isSuperAdmin(session) || can(session, 'view_all_tasks');
}

export function canEditAllTasks(session) {
  return isSuperAdmin(session) || can(session, 'edit_tasks');
}

export function canManageInvoices(session) {
  return isSuperAdmin(session) || can(session, 'manage_invoices');
}

export async function getUserMemberId(session) {
  if (!session) return null;
  const rows = await getSql()`
    SELECT id
    FROM team_members
    WHERE user_id = ${session.id} AND archived_at IS NULL
    LIMIT 1
  `;
  return rows[0]?.id || null;
}

export async function getAllowedCategoryIds(session) {
  if (canViewAllTasks(session)) return null;
  const rows = await getSql()`
    SELECT rc.category_id
    FROM role_categories rc
    JOIN users u ON u.role_id = rc.role_id
    WHERE u.id = ${session.id}
  `;
  return rows.map(row => row.category_id);
}

export async function canAccessTask(session, task) {
  if (!session || !task || task.archived_at) return false;
  if (canViewAllTasks(session)) return true;
  const [access] = await getSql()`
    SELECT 1 AS allowed
    WHERE EXISTS (
      SELECT 1 FROM team_members member
      WHERE member.user_id = ${session.id} AND member.archived_at IS NULL
        AND (
          member.id = ${task.assigned_to}::integer
          OR EXISTS (
            SELECT 1 FROM task_assignees ta
            WHERE ta.task_id = ${task.id} AND ta.member_id = member.id
          )
        )
    ) OR ${task.category_id}::integer IN (
      SELECT rc.category_id
      FROM role_categories rc
      JOIN users u ON u.role_id = rc.role_id
      WHERE u.id = ${session.id}
    )
    LIMIT 1
  `;
  return !!access;
}

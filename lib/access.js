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

export function canEditAllInvoices(session) {
  return isSuperAdmin(session) || can(session, 'manage_invoices') || can(session, 'edit_invoices');
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

/**
 * Category ids this session may see, or `null` for "no restriction".
 *
 * Precedence:
 *   1. `view_all_tasks` (or superadmin) - unrestricted, returns null.
 *   2. Per-user rows in `user_categories`, when any exist. These fully
 *      replace the role's list, so a superadmin can hand one person a
 *      deliberately narrow or deliberately wide set.
 *   3. Otherwise the role's `role_categories` list.
 *
 * An empty result is a real restriction (the person sees no categorised
 * tasks), not a fall-through to "everything" - otherwise deleting every row
 * would silently grant full access.
 */
export async function getAllowedCategoryIds(session) {
  if (canViewAllTasks(session)) return null;
  const perUser = await getSql()`
    SELECT category_id::text
    FROM user_categories
    WHERE user_id = ${session.id}
    ORDER BY category_id
  `;
  if (perUser.length) return perUser.map(row => row.category_id);
  const rows = await getSql()`
    SELECT rc.category_id
    FROM role_categories rc
    JOIN users u ON u.role_id = rc.role_id
    WHERE u.id = ${session.id}
  `;
  return rows.map(row => row.category_id);
}

/**
 * Whether this session may see a specific task.
 *
 * A task is visible when the person can see all tasks, is an assignee, or its
 * category is in scope. Uses the same precedence as
 * `getAllowedCategoryIds`, but inline in one query so the check is a single
 * round trip.
 */
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
      -- Per-user categories fully replace the role's list when any exist,
      -- mirroring getAllowedCategoryIds. The EXISTS guard selects the user
      -- branch only when it has at least one row, so a user with no
      -- per-user rows still falls back to their role's categories.
      SELECT uc.category_id
      FROM user_categories uc
      WHERE uc.user_id = ${session.id}
        AND EXISTS (SELECT 1 FROM user_categories WHERE user_id = ${session.id})
      UNION
      SELECT rc.category_id
      FROM role_categories rc
      JOIN users u ON u.role_id = rc.role_id
      WHERE u.id = ${session.id}
        AND NOT EXISTS (SELECT 1 FROM user_categories WHERE user_id = ${session.id})
    )
    LIMIT 1
  `;
  return !!access;
}

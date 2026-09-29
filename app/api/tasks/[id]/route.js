import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { can, canEditAllTasks, canViewAllTasks, getUserMemberId } from '@/lib/access';
import { db, genToken, getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { describeTaskChanges, normalizeTaskInput, TASK_PAYMENT_STATUSES, TASK_STATUSES, taskCapacity, validateTaskReferences } from '@/lib/tasks';
import { oneOf, optionalNumber, requiredTimestamp } from '@/lib/validation';

function assigneeAggregates(taskAlias, memberAlias) {
  return `
  COALESCE(
    (SELECT array_agg(ta.member_id::text ORDER BY ta.is_primary DESC, ta.member_id)
     FROM task_assignees ta WHERE ta.task_id = ${taskAlias}.id),
    CASE WHEN ${taskAlias}.assigned_to IS NULL THEN ARRAY[]::text[] ELSE ARRAY[${taskAlias}.assigned_to::text] END
  ) AS assignee_ids,
  COALESCE(
    (SELECT array_agg(tm2.name ORDER BY ta.is_primary DESC, tm2.name)
     FROM task_assignees ta JOIN team_members tm2 ON tm2.id = ta.member_id WHERE ta.task_id = ${taskAlias}.id),
    CASE WHEN ${taskAlias}.assigned_to IS NULL THEN ARRAY[]::text[] ELSE ARRAY[${memberAlias}.name] END
  ) AS assignee_names`;
}

const TASK_SELECT = `
  t.id::text, t.title, t.title AS task_title, t.description, t.notes,
  t.client_name, t.client_email, t.project_name,
  t.category_id::text, t.assigned_to::text,
  t.start_date::text, t.due_date::text, t.status, t.priority, t.progress,
  t.payment_status, t.amount_paid::float8 AS amount_paid, t.client_visible,
  t.share_token, t.created_by, t.created_at, t.updated_at, t.archived_at,
  c.name AS category_name, c.color AS category_color,
  tm.name AS assigned_name, tm.position AS assigned_role,
  ${assigneeAggregates('t', 'tm')}
`;

function serializeTask(task) {
  const assigneeIds = (task.assignee_ids || []).map(String);
  return {
    ...task,
    id: String(task.id),
    task_title: task.task_title || task.title,
    category_id: task.category_id === null || task.category_id === undefined ? null : String(task.category_id),
    assigned_to: task.assigned_to === null || task.assigned_to === undefined ? null : String(task.assigned_to),
    assignee_ids: assigneeIds.length ? assigneeIds : task.assigned_to ? [String(task.assigned_to)] : [],
    assignee_names: task.assignee_names || (task.assigned_name ? [task.assigned_name] : []),
  };
}

async function findTask(id, includeArchived = false) {
  const sql = getSql();
  const rows = await sql(`
    SELECT ${TASK_SELECT}
    FROM tasks t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN team_members tm ON tm.id = t.assigned_to
    WHERE t.id = $1 AND ($2::boolean OR t.archived_at IS NULL)
  `, [id, includeArchived]);
  return rows[0] ? serializeTask(rows[0]) : null;
}

async function canEditTask(session, task) {
  if (canEditAllTasks(session)) return true;
  if (!can(session, 'edit_own_tasks')) return false;
  const memberId = await getUserMemberId(session);
  if (!memberId) return false;
  return (task.assignee_ids || []).map(Number).includes(Number(memberId));
}

async function changeTaskShare(session, id, action, expected) {
  const current = await findTask(id);
  if (!current) throw new ApiError(404, 'Task not found');
  if (current.archived_at) throw new ApiError(409, 'Restore this task before changing its share link');
  if (!(await canEditTask(session, current))) throw new ApiError(403, 'Task editing access is required');
  const regenerate = action === 'regenerate_share';
  if (regenerate && !current.client_visible) {
    throw new ApiError(400, 'Turn on client visibility before sharing this task');
  }
  const token = regenerate ? genToken() : null;
  const [shared] = await getSql()`
    UPDATE tasks
    SET share_token = ${token}, updated_at = NOW()
    WHERE id = ${current.id}
      AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${expected}::timestamptz)
      AND archived_at IS NULL
    RETURNING id::text, title, title AS task_title, share_token, client_visible, updated_at
  `;
  if (!shared) throw new ApiError(409, 'Task changed since it was loaded');
  await getSql()`
    INSERT INTO task_activity (task_id, user_id, username, actor, action, details)
    VALUES (
      ${current.id}, ${session.id}::integer, ${session.username}, ${session.username},
      ${regenerate ? 'share_regenerated' : 'share_revoked'},
      ${regenerate
        ? 'Share link regenerated - the previous link no longer works'
        : 'Share link revoked - the client link no longer works'}
    )
  `;
  return shared;
}

export const GET = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'view_tasks')) throw new ApiError(403, 'Task access is required');
  const { id } = await params;
  const task = await findTask(id, new URL(request.url).searchParams.get('archived') === '1');
  if (!task) throw new ApiError(404, 'Task not found');
  if (!canViewAllTasks(session)) {
    const memberId = await getUserMemberId(session);
    const [access] = await getSql()`
      SELECT 1 AS allowed
      WHERE (
        ${memberId || 0}::integer IN (SELECT unnest(COALESCE(${task.assignee_ids || []}::text[], ARRAY[]::text[]))::integer)
        OR ${task.category_id || 0}::integer IN (
          SELECT rc.category_id
          FROM role_categories rc
          JOIN users u ON u.role_id = rc.role_id
          WHERE u.id = ${session.id}
        )
      )
    `;
    if (!access) throw new ApiError(404, 'Task not found');
  }
  return NextResponse.json(task, { headers: { 'Cache-Control': 'no-store' } });
});

export const PUT = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  const { id } = await params;
  const current = await findTask(id);
  if (!current) throw new ApiError(404, 'Task not found');
  if (!(await canEditTask(session, current))) throw new ApiError(403, 'Task editing access is required');
  const body = await requestJson(request);
  const expected = requiredTimestamp(body.expected, 'Expected update time');
  const input = normalizeTaskInput(body, current);
  if (!canEditAllTasks(session)) {
    input.assignee_ids = (current.assignee_ids || []).map(Number);
    input.assigned_to = current.assigned_to === null ? null : Number(current.assigned_to);
    if (!canViewAllTasks(session) && input.category_id) {
      const [allowed] = await getSql()`
        SELECT 1 FROM role_categories rc
        JOIN users u ON u.role_id = rc.role_id
        WHERE u.id = ${session.id} AND rc.category_id = ${input.category_id}
      `;
      if (!allowed) throw new ApiError(403, 'You cannot assign that category');
    }
  }
  await validateTaskReferences(input);
  const capacity = taskCapacity();
  const assigneeIds = input.assignee_ids || [];
  const changes = describeTaskChanges(current, input);
  const [, , rows] = await db.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(hashtext('task-capacity:' || member_id::text))
      FROM unnest(COALESCE(${assigneeIds}::integer[], ARRAY[]::integer[])) AS member_id
    `,
    txn`
      UPDATE task_assignees
      SET is_primary = FALSE
      WHERE task_id = ${current.id}
        AND is_primary = TRUE
        AND member_id = ANY(COALESCE(${assigneeIds}::integer[], ARRAY[]::integer[]))
        AND member_id <> COALESCE(${input.assigned_to}::integer, -1)
        AND EXISTS (
          SELECT 1 FROM tasks
          WHERE id = ${current.id}
            AND archived_at IS NULL
            AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${expected}::timestamptz)
          FOR UPDATE
        )
    `,
    txn`
      WITH assignee_list AS (
        SELECT member_id, ord
        FROM unnest(COALESCE(${assigneeIds}::integer[], ARRAY[]::integer[])) WITH ORDINALITY AS u(member_id, ord)
      ), assignee_names AS (
        SELECT assignee_list.member_id, assignee_list.ord, tm.name
        FROM assignee_list LEFT JOIN team_members tm ON tm.id = assignee_list.member_id
      ), capacity_ok AS (
        SELECT 1 AS ok
        WHERE NOT EXISTS (
          SELECT 1
          FROM assignee_list
          WHERE (
            SELECT COUNT(*)
            FROM tasks existing
            WHERE existing.id <> ${current.id}
              AND existing.archived_at IS NULL
              AND existing.status <> 'done'
              AND existing.start_date <= ${input.due_date}
              AND existing.due_date >= ${input.start_date}
              AND (
                existing.assigned_to = assignee_list.member_id
                OR EXISTS (
                  SELECT 1 FROM task_assignees ea
                  WHERE ea.task_id = existing.id AND ea.member_id = assignee_list.member_id
                )
              )
          ) >= ${capacity}
        )
      ), updated AS (
        UPDATE tasks
        SET title = ${input.title}, description = ${input.description}, notes = ${input.notes},
          client_name = ${input.client_name}, client_email = ${input.client_email},
          project_name = ${input.project_name},
          category_id = ${input.category_id}, assigned_to = ${input.assigned_to},
          start_date = ${input.start_date}, due_date = ${input.due_date},
          status = ${input.status}, priority = ${input.priority}, progress = ${input.progress},
          payment_status = ${input.payment_status}, amount_paid = ${input.amount_paid},
          client_visible = ${input.client_visible}, updated_at = NOW()
        FROM capacity_ok
        WHERE id = ${current.id} AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${expected}::timestamptz) AND archived_at IS NULL
        RETURNING *
      ), deleted_assignees AS (
        DELETE FROM task_assignees
        WHERE task_id = ${current.id}
          AND member_id NOT IN (SELECT member_id FROM assignee_list)
        RETURNING task_id
      ), upserted_assignees AS (
        INSERT INTO task_assignees (task_id, member_id, is_primary)
        SELECT ${current.id}, assignee_list.member_id, assignee_list.member_id = COALESCE(${input.assigned_to}::integer, -1)
        FROM assignee_list
        ON CONFLICT (task_id, member_id)
        DO UPDATE SET is_primary = EXCLUDED.is_primary
        RETURNING member_id
      ), activity AS (
        INSERT INTO task_activity (task_id, user_id, username, actor, action, details)
        SELECT id, ${session.id}::integer, ${session.username}, ${session.username}, 'updated', ${changes || 'No field changes'}
        FROM updated
      )
      SELECT updated.*,
        updated.start_date::text AS start_date,
        updated.due_date::text AS due_date,
        ARRAY(SELECT member_id::text FROM assignee_list ORDER BY ord) AS assignee_ids,
        ARRAY(SELECT name FROM assignee_names ORDER BY ord) AS assignee_names
      FROM updated
    `,
  ]);
  if (!rows[0]) {
    const latest = await findTask(id);
    const unchanged = latest && new Date(latest.updated_at).getTime() === new Date(expected).getTime();
    if (!unchanged) throw new ApiError(409, 'Task changed since it was loaded');
    throw new ApiError(409, 'One or more assigned team members are already at capacity for those dates');
  }
  return NextResponse.json(serializeTask(rows[0]));
});

export const PATCH = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  const { id } = await params;
  const body = await requestJson(request);
  const expected = requiredTimestamp(body.expected, 'Expected update time');

  if (body.action === 'restore') {
    if (!can(session, 'delete_tasks')) throw new ApiError(403, 'Archived task access is required');
    const current = await findTask(id, true);
    if (!current || !current.archived_at) throw new ApiError(404, 'Archived task not found');
    const token = genToken();
    const [restored] = await getSql()`
      UPDATE tasks
      SET archived_at = NULL, share_token = ${token}, updated_at = NOW()
      WHERE id = ${current.id} AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${expected}::timestamptz) AND archived_at IS NOT NULL
      RETURNING id::text, title, title AS task_title, archived_at, share_token, updated_at
    `;
    if (!restored) throw new ApiError(409, 'Task changed since it was loaded');
    await getSql()`
      INSERT INTO task_activity (task_id, user_id, username, actor, action, details)
      VALUES (${current.id}, ${session.id}::integer, ${session.username}, ${session.username}, 'restored', 'Task restored from trash')
    `;
    return NextResponse.json(restored);
  }

  if (body.action === 'regenerate_share' || body.action === 'revoke_share') {
    const shared = await changeTaskShare(session, id, body.action, expected);
    return NextResponse.json(shared);
  }

  const current = await findTask(id);
  if (!current) throw new ApiError(404, 'Task not found');
  if (!(await canEditTask(session, current))) throw new ApiError(403, 'Task editing access is required');
  const status = body.status === undefined ? current.status : oneOf(body.status, 'Status', TASK_STATUSES);
  const progress = body.progress === undefined
    ? current.progress
    : optionalNumber(body.progress, 'Progress', { min: 0, max: 100, integer: true });
  const paymentStatus = body.payment_status === undefined
    ? current.payment_status
    : oneOf(body.payment_status, 'Payment status', TASK_PAYMENT_STATUSES);
  let amountPaid = body.amount_paid === undefined
    ? Number(current.amount_paid || 0)
    : optionalNumber(body.amount_paid, 'Amount paid', { min: 0, max: 999999999999.99 });
  if (paymentStatus === 'unpaid') amountPaid = 0;
  if (paymentStatus !== 'unpaid' && amountPaid <= 0) throw new ApiError(400, 'Paid tasks require an amount greater than zero');
  const finalProgress = status === 'done' ? 100 : progress;
  const changes = describeTaskChanges(current, {
    status,
    progress: finalProgress,
    payment_status: paymentStatus,
    amount_paid: amountPaid,
  });
  const [updated] = await getSql()`
    WITH updated AS (
      UPDATE tasks
      SET status = ${status}, progress = ${finalProgress},
        payment_status = ${paymentStatus}, amount_paid = ${amountPaid}, updated_at = NOW()
      WHERE id = ${current.id} AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${expected}::timestamptz) AND archived_at IS NULL
      RETURNING *
    ), activity AS (
      INSERT INTO task_activity (task_id, user_id, username, actor, action, details)
      SELECT id, ${session.id}::integer, ${session.username}, ${session.username}, 'updated', ${changes}
      FROM updated
    )
    SELECT * FROM updated
  `;
  if (!updated) throw new ApiError(409, 'Task changed since it was loaded');
  return NextResponse.json({ ...updated, task_title: updated.title });
});

export const DELETE = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'delete_tasks')) throw new ApiError(403, 'Task deletion access is required');
  const { id } = await params;
  const permanent = new URL(request.url).searchParams.get('permanent') === '1';
  if (permanent && session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
  const current = await findTask(id, permanent);
  if (!current) throw new ApiError(404, 'Task not found');
  if (permanent) {
    if (!current.archived_at) throw new ApiError(409, 'Task must be archived before permanent deletion');
    await getSql()`DELETE FROM tasks WHERE id = ${current.id} AND archived_at IS NOT NULL`;
    return NextResponse.json({ ok: true, permanent: true });
  }
  if (current.status === 'done' && session.role !== 'superadmin') {
    throw new ApiError(403, 'Only a superadmin can archive completed tasks');
  }
  const [archived] = await getSql()`
    UPDATE tasks
    SET archived_at = NOW(), share_token = NULL, updated_at = NOW()
    WHERE id = ${current.id} AND archived_at IS NULL
    RETURNING id::text
  `;
  if (!archived) throw new ApiError(409, 'Task was already archived');
  await getSql()`
    INSERT INTO task_activity (task_id, user_id, username, actor, action, details)
    VALUES (${current.id}, ${session.id}::integer, ${session.username}, ${session.username}, 'archived', 'Task archived and public link revoked')
  `;
  return NextResponse.json({ ok: true, permanent: false });
});

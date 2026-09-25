import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { can, canEditAllTasks, canViewAllTasks } from '@/lib/access';
import { db, genToken, getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { normalizeTaskInput, TASK_STATUSES, taskCapacity, validateTaskReferences } from '@/lib/tasks';
import { oneOf, optionalNumber, requiredId, requiredTimestamp } from '@/lib/validation';

const TASK_SELECT = `
  t.id::text, t.title, t.title AS task_title, t.description,
  t.client_name, t.client_email, t.project_name,
  t.category_id::text, t.assigned_to::text,
  t.start_date, t.due_date, t.status, t.priority, t.progress,
  t.payment_status, t.amount_paid::float8 AS amount_paid, t.client_visible,
  t.share_token, t.created_by, t.created_at, t.updated_at, t.archived_at,
  c.name AS category_name, c.color AS category_color,
  tm.name AS assigned_name, tm.position AS assigned_role
`;

function serializeTask(task) {
  return {
    ...task,
    task_title: task.task_title || task.title,
    id: String(task.id),
    category_id: task.category_id === null || task.category_id === undefined ? null : String(task.category_id),
    assigned_to: task.assigned_to === null || task.assigned_to === undefined ? null : String(task.assigned_to),
  };
}

async function createTask(input, actor, token) {
  const capacity = taskCapacity();
  const [rows] = await db.transaction(txn => [
    txn`
      WITH capacity_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtext(${'task-capacity:' + (input.assigned_to || 0)}))
      ), capacity_ok AS (
        SELECT 1
        FROM capacity_lock
        WHERE ${input.assigned_to}::integer IS NULL
          OR (
            SELECT COUNT(*)
            FROM tasks existing
            WHERE existing.assigned_to = ${input.assigned_to}
              AND existing.archived_at IS NULL
              AND existing.status <> 'done'
              AND existing.start_date <= ${input.due_date}
              AND existing.due_date >= ${input.start_date}
          ) < ${capacity}
      ), created AS (
        INSERT INTO tasks (
          title, description, client_name, client_email, project_name,
          category_id, assigned_to, start_date, due_date,
          status, priority, progress, payment_status, amount_paid,
          client_visible, share_token, created_by
        )
        SELECT ${input.title}, ${input.description}, ${input.client_name}, ${input.client_email}, ${input.project_name},
          ${input.category_id}, ${input.assigned_to}, ${input.start_date}, ${input.due_date}, ${input.status}, ${input.priority},
          ${input.progress}, ${input.payment_status}, ${input.amount_paid},
          ${input.client_visible}, ${token}, ${actor.username}
        FROM capacity_ok
        RETURNING *
      ), activity AS (
        INSERT INTO task_activity (task_id, user_id, username, actor, action, details)
        SELECT id, ${actor.id}::integer, ${actor.username}, ${actor.username}, 'created', 'Task created'
        FROM created
      )
      SELECT * FROM created
    `,
  ]);
  return rows[0] || null;
}

export const GET = withApi(async request => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'view_tasks')) throw new ApiError(403, 'Task access is required');
  const searchParams = new URL(request.url).searchParams;
  const includeArchived = searchParams.get('archived') === '1';
  const trash = searchParams.get('trash') === '1';
  if ((includeArchived || trash) && !can(session, 'delete_tasks')) throw new ApiError(403, 'Archived task access is required');
  const sql = getSql();
  const tasks = canViewAllTasks(session)
    ? await sql(`
        SELECT ${TASK_SELECT}
        FROM tasks t
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN team_members tm ON tm.id = t.assigned_to
        WHERE ($1::boolean AND t.archived_at IS NOT NULL)
           OR (NOT $1::boolean AND ($2::boolean OR t.archived_at IS NULL))
        ORDER BY t.due_date, t.id
      `, [trash, includeArchived])
    : await sql(`
        SELECT ${TASK_SELECT}
        FROM tasks t
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN team_members tm ON tm.id = t.assigned_to
        WHERE (($1::boolean AND t.archived_at IS NOT NULL)
           OR (NOT $1::boolean AND ($2::boolean OR t.archived_at IS NULL)))
          AND (
            EXISTS (
              SELECT 1 FROM team_members member
              WHERE member.id = t.assigned_to AND member.user_id = $3 AND member.archived_at IS NULL
            )
            OR t.category_id IN (
              SELECT rc.category_id
              FROM role_categories rc
              JOIN users u ON u.role_id = rc.role_id
              WHERE u.id = $3
            )
          )
        ORDER BY t.due_date, t.id
      `, [trash, includeArchived, session.id]);
  return NextResponse.json(tasks, { headers: { 'Cache-Control': 'no-store' } });
});

export const POST = withApi(async request => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'create_tasks')) throw new ApiError(403, 'Task creation access is required');
  const body = await requestJson(request);
  if (body.tasks !== undefined) {
    if (!Array.isArray(body.tasks) || body.tasks.length < 1 || body.tasks.length > 100) {
      throw new ApiError(400, 'Bulk tasks must contain between 1 and 100 items');
    }
    const inputs = body.tasks.map(item => normalizeTaskInput(item));
    const categoryIds = [...new Set(inputs.map(input => input.category_id).filter(Boolean))];
    const memberIds = [...new Set(inputs.map(input => input.assigned_to).filter(Boolean))];
    const sql = getSql();
    if (categoryIds.length) {
      const categories = await sql`SELECT id FROM categories WHERE id = ANY(${categoryIds}) AND archived_at IS NULL`;
      if (categories.length !== categoryIds.length) throw new ApiError(400, 'One or more categories do not exist');
    }
    if (memberIds.length) {
      const members = await sql`SELECT id FROM team_members WHERE id = ANY(${memberIds}) AND archived_at IS NULL`;
      if (members.length !== memberIds.length) throw new ApiError(400, 'One or more team members do not exist');
    }
    const payload = inputs.map((input, index) => ({ ...input, ordinal: index + 1, token: genToken() }));
    const capacity = taskCapacity();
    const [rows] = await db.transaction(txn => [
      txn`
        WITH input AS (
          SELECT value AS task, ordinality::integer AS ordinal
          FROM jsonb_array_elements(${JSON.stringify(payload)}::jsonb) WITH ORDINALITY
        ), decoded AS (
          SELECT
            task->>'ordinal'::integer AS ordinal,
            task->>'title' AS title,
            task->>'description' AS description,
            task->>'client_name' AS client_name,
            task->>'client_email' AS client_email,
            task->>'project_name' AS project_name,
            NULLIF(task->>'category_id', '')::integer AS category_id,
            NULLIF(task->>'assigned_to', '')::integer AS assigned_to,
            task->>'start_date'::date AS start_date,
            task->>'due_date'::date AS due_date,
            task->>'status' AS status,
            task->>'priority' AS priority,
            task->>'progress'::integer AS progress,
            task->>'payment_status' AS payment_status,
            task->>'amount_paid'::numeric AS amount_paid,
            (task->>'client_visible')::boolean AS client_visible,
            task->>'token' AS token
          FROM input
        ), loads AS (
          SELECT decoded.*,
            CASE WHEN assigned_to IS NULL THEN 0 ELSE (
              SELECT COUNT(*) FROM tasks existing
              WHERE existing.assigned_to = decoded.assigned_to
                AND existing.archived_at IS NULL
                AND existing.status <> 'done'
                AND existing.start_date <= decoded.due_date
                AND existing.due_date >= decoded.start_date
            ) + (
              SELECT COUNT(*) FROM decoded prior
              WHERE prior.ordinal < decoded.ordinal
                AND prior.assigned_to = decoded.assigned_to
                AND prior.start_date <= decoded.due_date
                AND prior.due_date >= decoded.start_date
            ) END AS assigned_load
          FROM decoded
        ), gate AS (
          SELECT 1 WHERE NOT EXISTS (
            SELECT 1 FROM loads WHERE assigned_to IS NOT NULL AND assigned_load >= ${capacity}
          )
        ), created AS (
          INSERT INTO tasks (
            title, description, client_name, client_email, project_name,
            category_id, assigned_to, start_date, due_date,
            status, priority, progress, payment_status, amount_paid,
            client_visible, share_token, created_by
          )
          SELECT title, description, client_name, client_email, project_name,
            category_id, assigned_to, start_date, due_date,
            status, priority, progress, payment_status, amount_paid,
            client_visible, token, ${session.username}
          FROM loads CROSS JOIN gate
          ORDER BY ordinal
          RETURNING *
        ), activity AS (
          INSERT INTO task_activity (task_id, user_id, username, actor, action, details)
          SELECT id, ${session.id}::integer, ${session.username}, ${session.username}, 'created', 'Task created'
          FROM created
        )
        SELECT * FROM created ORDER BY id
      `,
    ]);
    if (rows.length !== payload.length) throw new ApiError(409, 'One or more tasks exceed the assignee capacity');
    return NextResponse.json(rows.map(serializeTask), { status: 201 });
  }

  const input = normalizeTaskInput(body);
  await validateTaskReferences(input);
  const created = await createTask(input, session, genToken());
  if (!created) throw new ApiError(409, 'The assigned team member is already at capacity for those dates');
  return NextResponse.json(serializeTask(created), { status: 201 });
});

export const PUT = withApi(async request => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!canEditAllTasks(session) && !can(session, 'edit_own_tasks')) throw new ApiError(403, 'Task editing access is required');
  const body = await requestJson(request);
  if (!Array.isArray(body.tasks) || body.tasks.length < 1 || body.tasks.length > 100) {
    throw new ApiError(400, 'tasks must contain between 1 and 100 items');
  }
  const items = body.tasks.map(item => {
    const status = oneOf(item.status, 'Status', TASK_STATUSES);
    return {
      id: requiredId(item.id, 'Task ID'),
      status,
      progress: status === 'done' ? 100 : optionalNumber(item.progress, 'Progress', { min: 0, max: 100, integer: true }),
      updated_at: requiredTimestamp(item.expected ?? item.updated_at, 'Expected update time'),
    };
  });
  const [rows] = await db.transaction(txn => [
    txn`
      WITH input AS (
        SELECT value AS item
        FROM jsonb_array_elements(${JSON.stringify(items)}::jsonb)
      ), decoded AS (
        SELECT
          item->>'id'::integer AS id,
          item->>'status' AS status,
          item->>'progress'::integer AS progress,
          item->>'updated_at'::timestamptz AS updated_at
        FROM input
      ), gate AS (
        SELECT 1
        WHERE NOT EXISTS (
          SELECT 1
          FROM decoded
          LEFT JOIN tasks current ON current.id = decoded.id AND current.archived_at IS NULL
          WHERE current.id IS NULL
            OR current.updated_at IS DISTINCT FROM decoded.updated_at
            OR NOT (
              ${canEditAllTasks(session)}
              OR current.assigned_to IN (
                SELECT id FROM team_members WHERE user_id = ${session.id} AND archived_at IS NULL
              )
            )
        )
      ), updated AS (
        UPDATE tasks
        SET status = decoded.status,
            progress = CASE WHEN decoded.status = 'done' THEN 100 ELSE COALESCE(decoded.progress, tasks.progress) END,
            updated_at = NOW()
        FROM decoded CROSS JOIN gate
        WHERE tasks.id = decoded.id AND tasks.updated_at = decoded.updated_at
        RETURNING tasks.*
      ), activity AS (
        INSERT INTO task_activity (task_id, user_id, username, actor, action, details)
        SELECT id, ${session.id}::integer, ${session.username}, ${session.username}, 'status',
          'status: ' || status
        FROM updated
      )
      SELECT * FROM updated ORDER BY id
    `,
  ]);
  if (rows.length !== items.length) throw new ApiError(409, 'One or more tasks changed or is no longer editable');
  return NextResponse.json(rows.map(serializeTask));
});

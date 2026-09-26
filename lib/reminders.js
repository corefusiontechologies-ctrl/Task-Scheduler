import { db, getSql } from './db';
import { addDays, businessDate } from './dates';
import { sendInvoiceReminder, sendTaskReminder } from './email';

const EMAIL_PATTERN = '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}';

function reminderWindow(type = 'task') {
  const variable = type === 'invoice' ? 'INVOICE_REMINDER_WINDOW_DAYS' : 'TASK_REMINDER_WINDOW_DAYS';
  const configured = Number.parseInt(process.env[variable] || '2', 10);
  return Number.isFinite(configured) ? Math.max(0, Math.min(14, configured)) : 2;
}

async function enqueueTaskReminders(today) {
  const sql = getSql();
  const windowEnd = addDays(today, reminderWindow());
  const dueSoon = await sql`
    INSERT INTO reminder_deliveries (
      dedupe_key, reminder_type, entity_type, entity_id, scheduled_for,
      recipient, subject, payload
    )
    SELECT
      'task-due-employee-' || task.id::text || '-' || task.due_date::text || '-' || member.id::text,
      'task_due_soon', 'task', task.id, ${today}::date, lower(member.email),
      'Task due soon: ' || task.title,
      jsonb_build_object('task_id', task.id, 'kind', 'due_soon', 'recipient_kind', 'employee', 'recipient_name', member.name)
    FROM tasks task
    JOIN task_assignees link ON link.task_id = task.id
    JOIN team_members member ON member.id = link.member_id AND member.archived_at IS NULL
    WHERE task.archived_at IS NULL
      AND task.status <> 'done'
      AND task.due_date BETWEEN ${today}::date AND ${windowEnd}::date
      AND lower(member.email) ~* ${EMAIL_PATTERN}
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id
  `;
  const clientDueSoon = await sql`
    INSERT INTO reminder_deliveries (
      dedupe_key, reminder_type, entity_type, entity_id, scheduled_for,
      recipient, subject, payload
    )
    SELECT
      'task-due-client-' || task.id::text || '-' || task.due_date::text,
      'task_due_soon', 'task', task.id, ${today}::date, lower(task.client_email),
      'Task update: ' || task.title,
      jsonb_build_object('task_id', task.id, 'kind', 'due_soon', 'recipient_kind', 'client', 'recipient_name', task.client_name)
    FROM tasks task
    WHERE task.archived_at IS NULL
      AND task.status <> 'done'
      AND task.client_visible = TRUE
      AND task.share_token IS NOT NULL
      AND task.due_date BETWEEN ${today}::date AND ${windowEnd}::date
      AND lower(task.client_email) ~* ${EMAIL_PATTERN}
      AND NOT EXISTS (
        SELECT 1 FROM task_assignees link
        JOIN team_members member ON member.id = link.member_id
        WHERE link.task_id = task.id
          AND member.archived_at IS NULL
          AND lower(member.email) = lower(task.client_email)
      )
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id
  `;
  const overdue = await sql`
    INSERT INTO reminder_deliveries (
      dedupe_key, reminder_type, entity_type, entity_id, scheduled_for,
      recipient, subject, payload
    )
    SELECT
      'task-overdue-employee-' || task.id::text || '-' || task.due_date::text || '-' || member.id::text,
      'task_overdue', 'task', task.id, ${today}::date, lower(member.email),
      'Overdue task: ' || task.title,
      jsonb_build_object('task_id', task.id, 'kind', 'overdue', 'recipient_kind', 'employee', 'recipient_name', member.name)
    FROM tasks task
    JOIN task_assignees link ON link.task_id = task.id
    JOIN team_members member ON member.id = link.member_id AND member.archived_at IS NULL
    WHERE task.archived_at IS NULL
      AND task.status <> 'done'
      AND task.due_date < ${today}::date
      AND task.due_date >= ${addDays(today, -30)}::date
      AND lower(member.email) ~* ${EMAIL_PATTERN}
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id
  `;
  return dueSoon.length + clientDueSoon.length + overdue.length;
}

async function enqueueInvoiceReminders(today) {
  const sql = getSql();
  const windowEnd = addDays(today, reminderWindow('invoice'));
  const dueSoon = await sql`
    INSERT INTO reminder_deliveries (
      dedupe_key, reminder_type, entity_type, entity_id, scheduled_for,
      recipient, subject, payload
    )
    SELECT
      'invoice-due-' || invoice.id::text || '-' || invoice.issue_date::text || '-' || invoice.due_date::text,
      'invoice_due_soon', 'invoice', invoice.id, ${today}::date, lower(invoice.client_email),
      'Invoice due soon: ' || invoice.invoice_number,
      jsonb_build_object('invoice_id', invoice.id, 'kind', 'due_soon')
    FROM invoices invoice
    WHERE invoice.archived_at IS NULL
      AND invoice.client_visible = TRUE
      AND invoice.share_token IS NOT NULL
      AND invoice.payment_status <> 'paid'
      AND invoice.due_date BETWEEN ${today}::date AND ${windowEnd}::date
      AND lower(invoice.client_email) ~* ${EMAIL_PATTERN}
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id
  `;
  const overdue = await sql`
    INSERT INTO reminder_deliveries (
      dedupe_key, reminder_type, entity_type, entity_id, scheduled_for,
      recipient, subject, payload
    )
    SELECT
      'invoice-overdue-' || invoice.id::text || '-' || invoice.issue_date::text || '-' || invoice.due_date::text,
      'invoice_overdue', 'invoice', invoice.id, ${today}::date, lower(invoice.client_email),
      'Overdue invoice ' || invoice.invoice_number,
      jsonb_build_object('invoice_id', invoice.id, 'kind', 'overdue')
    FROM invoices invoice
    WHERE invoice.archived_at IS NULL
      AND invoice.client_visible = TRUE
      AND invoice.share_token IS NOT NULL
      AND invoice.payment_status <> 'paid'
      AND invoice.due_date < ${today}::date
      AND invoice.due_date >= ${addDays(today, -30)}::date
      AND lower(invoice.client_email) ~* ${EMAIL_PATTERN}
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id
  `;
  return dueSoon.length + overdue.length;
}

async function claimDeliveries(types, limit) {
  return db.transaction(async transaction => transaction`
    UPDATE reminder_deliveries
    SET status = 'sending', attempts = attempts + 1, locked_at = NOW(), updated_at = NOW()
    WHERE id IN (
      SELECT id
      FROM reminder_deliveries
      WHERE (
        (status IN ('pending', 'retry') AND next_attempt <= NOW())
        OR (status = 'sending' AND locked_at < NOW() - INTERVAL '15 minutes')
      )
        AND reminder_type IN (${types})
        AND attempts < max_attempts
      ORDER BY scheduled_for, id
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id::text, dedupe_key, reminder_type, entity_type, entity_id::text,
      recipient, payload, attempts, max_attempts
  `);
}

async function currentTask(delivery) {
  const rows = await getSql()`
    SELECT task.id::text, task.title, task.client_name, task.due_date::text,
      task.share_token, task.client_email, task.status, task.archived_at,
      member.id::text AS member_id, member.name AS member_name, member.email AS member_email
    FROM tasks task
    LEFT JOIN task_assignees link ON link.task_id = task.id
    LEFT JOIN team_members member ON member.id = link.member_id AND member.archived_at IS NULL
    WHERE task.id = ${delivery.entity_id}
  `;
  const task = rows[0];
  if (!task || task.archived_at || task.status === 'done') return null;
  if (delivery.payload.recipient_kind === 'client') {
    if (lowerEmail(task.client_email) !== lowerEmail(delivery.recipient) || !task.share_token) return null;
  } else if (
    lowerEmail(task.member_email) !== lowerEmail(delivery.recipient)
    || !task.member_id
  ) return null;
  return task;
}

async function currentInvoice(delivery) {
  const rows = await getSql()`
    SELECT id::text, invoice_number, client_name, client_email, due_date::text,
      issue_date::text, total, currency, share_token, payment_status, archived_at
    FROM invoices
    WHERE id = ${delivery.entity_id}
  `;
  const invoice = rows[0];
  if (!invoice || invoice.archived_at || invoice.payment_status === 'paid' || !invoice.share_token) return null;
  if (lowerEmail(invoice.client_email) !== lowerEmail(delivery.recipient)) return null;
  return invoice;
}

function lowerEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function cancelDelivery(delivery, reason) {
  await getSql()`
    UPDATE reminder_deliveries
    SET status = 'cancelled', last_error = ${String(reason).slice(0, 1000)}, updated_at = NOW()
    WHERE id = ${delivery.id} AND status = 'sending'
  `;
}

async function completeDelivery(delivery, result) {
  await getSql()`
    UPDATE reminder_deliveries
    SET status = 'sent', sent_at = NOW(), provider_message_id = ${result?.id || null},
      locked_at = NULL, last_error = NULL, updated_at = NOW()
    WHERE id = ${delivery.id} AND status = 'sending'
  `;
}

async function failDelivery(delivery, error) {
  const message = String(error instanceof Error ? error.message : error || 'Unknown email error').slice(0, 1000);
  await getSql()`
    UPDATE reminder_deliveries
    SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'retry' END,
      next_attempt = NOW() + make_interval(secs => LEAST(3600, 30 * power(2, attempts))),
      locked_at = NULL, last_error = ${message}, updated_at = NOW()
    WHERE id = ${delivery.id} AND status = 'sending'
  `;
}

export async function runTaskReminderJob(limit = 25) {
  const today = businessDate();
  const enqueued = await enqueueTaskReminders(today);
  const deliveries = await claimDeliveries(['task_due_soon', 'task_overdue'], limit);
  let sent = 0;
  let cancelled = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    const task = await currentTask(delivery);
    if (!task) {
      await cancelDelivery(delivery, 'Task is no longer eligible for this reminder');
      cancelled += 1;
      continue;
    }
    try {
      const result = await sendTaskReminder({
        recipient: delivery.recipient,
        recipientName: delivery.payload.recipient_name,
        task,
        kind: delivery.payload.kind,
        idempotencyKey: delivery.dedupe_key,
      });
      await completeDelivery(delivery, result);
      sent += 1;
    } catch (error) {
      await failDelivery(delivery, error);
      failed += 1;
    }
  }
  return { enqueued, claimed: deliveries.length, sent, cancelled, failed };
}

export async function runInvoiceReminderJob(limit = 25) {
  const today = businessDate();
  const enqueued = await enqueueInvoiceReminders(today);
  const deliveries = await claimDeliveries(['invoice_due_soon', 'invoice_overdue'], limit);
  let sent = 0;
  let cancelled = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    const invoice = await currentInvoice(delivery);
    if (!invoice) {
      await cancelDelivery(delivery, 'Invoice is no longer eligible for this reminder');
      cancelled += 1;
      continue;
    }
    try {
      const result = await sendInvoiceReminder({
        invoice,
        kind: delivery.payload.kind,
        idempotencyKey: delivery.dedupe_key,
      });
      await completeDelivery(delivery, result);
      sent += 1;
    } catch (error) {
      await failDelivery(delivery, error);
      failed += 1;
    }
  }
  return { enqueued, claimed: deliveries.length, sent, cancelled, failed };
}

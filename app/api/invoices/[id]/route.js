import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { can, canManageInvoices } from '@/lib/access';
import { genToken, getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { normalizeInvoiceInput, validateInvoiceDates } from '@/lib/invoices';
import { calcInvoiceTotal } from '@/lib/invoiceMath';
import { requiredTimestamp } from '@/lib/validation';

const INVOICE_SELECT = `
  i.id::text, i.invoice_number, i.client_name, i.client_email,
  i.client_company, i.client_address, i.project_name,
  i.issue_date, i.issue_date AS invoice_date, i.due_date,
  i.status, i.payment_status, i.currency, i.tax_rate::float8 AS tax_rate,
  i.subtotal::float8 AS subtotal, i.tax_amount::float8 AS tax_amount,
  i.discount::float8 AS discount, i.total::float8 AS total,
  i.amount_paid::float8 AS amount_paid,
  i.notes, i.terms, i.share_token, i.created_by, i.created_by_id::text,
  i.created_at, i.updated_at, i.archived_at,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', item.id::text,
      'description', item.description,
      'quantity', item.quantity::float8,
      'unit_price', item.unit_price::float8,
      'amount', item.amount::float8
    ) ORDER BY item.id)
    FROM invoice_items item
    WHERE item.invoice_id = i.id
  ), '[]'::jsonb) AS items
`;

async function findInvoice(id, includeArchived = false) {
  const rows = await getSql()(`
    SELECT ${INVOICE_SELECT}
    FROM invoices i
    WHERE i.id = $1 AND ($2::boolean OR i.archived_at IS NULL)
  `, [id, includeArchived]);
  return rows[0] || null;
}

function canViewInvoice(session, invoice) {
  return canManageInvoices(session) || String(invoice.created_by_id) === String(session.id);
}

function canEditInvoice(session, invoice) {
  if (canManageInvoices(session)) return true;
  return can(session, 'edit_own_invoices') && String(invoice.created_by_id) === String(session.id);
}

function serializeInvoice(invoice) {
  return { ...invoice, id: String(invoice.id) };
}

export const GET = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'view_invoices')) throw new ApiError(403, 'Invoice access is required');
  const { id } = await params;
  const invoice = await findInvoice(id, new URL(request.url).searchParams.get('archived') === '1');
  if (!invoice) throw new ApiError(404, 'Invoice not found');
  if (!canViewInvoice(session, invoice)) throw new ApiError(404, 'Invoice not found');
  return NextResponse.json(invoice, { headers: { 'Cache-Control': 'no-store' } });
});

export const PUT = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  const { id } = await params;
  const current = await findInvoice(id, true);
  if (!current) throw new ApiError(404, 'Invoice not found');
  const body = await requestJson(request);
  const expected = requiredTimestamp(body.expected, 'Expected update time');
  const input = normalizeInvoiceInput(body, current);
  validateInvoiceDates(input.invoice_date, input.due_date);
  const paymentDelta = Math.round((input.amount_paid - Number(current.amount_paid || 0)) * 100) / 100;
  const [updated] = await getSql()`
    WITH current_items AS (
      SELECT updated.*, EXISTS(
        SELECT 1 FROM invoice_items existing WHERE existing.invoice_id = updated.id
      ) AS had_items
      FROM (
        UPDATE invoices
        SET client_name = ${input.client_name}, client_email = ${input.client_email},
          client_company = ${input.client_company}, client_address = ${input.client_address},
          project_name = ${input.project_name}, issue_date = ${input.invoice_date},
          due_date = ${input.due_date}, status = ${input.payment_status},
          payment_status = ${input.payment_status}, currency = ${input.currency},
          subtotal = ${input.subtotal}, tax_rate = ${input.tax_rate}, tax_amount = ${input.tax_amount},
          discount = ${input.discount}, total = ${input.total}, amount_paid = ${input.amount_paid}, notes = ${input.notes},
          terms = ${input.terms}, updated_at = NOW()
        WHERE id = ${current.id} AND updated_at = ${expected} AND archived_at IS NULL
        RETURNING *
      ) updated
    ), deleted_items AS (
      DELETE FROM invoice_items
      USING current_items
      WHERE invoice_items.invoice_id = current_items.id
      RETURNING invoice_items.invoice_id
    ), ready_items AS (
      SELECT current_items.id
      FROM current_items
      LEFT JOIN (
        SELECT DISTINCT invoice_id FROM deleted_items
      ) deleted ON deleted.invoice_id = current_items.id
      WHERE NOT current_items.had_items OR deleted.invoice_id IS NOT NULL
    ), inserted_items AS (
      INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
      SELECT ready_items.id, item.description, item.quantity, item.unit_price, item.amount
      FROM ready_items
      CROSS JOIN jsonb_array_elements(${JSON.stringify(input.items)}::jsonb) AS item
      RETURNING invoice_id
    ), payment AS (
      INSERT INTO invoice_payments (invoice_id, amount, actor)
      SELECT id, ${paymentDelta}, ${session.username}
      FROM current_items
      WHERE ${paymentDelta} <> 0
      RETURNING invoice_id
    ), activity AS (
      INSERT INTO task_activity (user_id, username, actor, action, details)
      SELECT ${session.id}::integer, ${session.username}, ${session.username}, 'invoice_updated',
        jsonb_build_object('invoice_id', current_items.id, 'invoice_number', invoices.invoice_number)::text
      FROM current_items
      JOIN invoices ON invoices.id = current_items.id
    )
    SELECT * FROM current_items
  `;
  if (!updated[0]) throw new ApiError(409, 'Invoice changed since it was loaded');
  return NextResponse.json(serializeInvoice({ ...updated[0], items: input.items }));
});

export const PATCH = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  const { id } = await params;
  const body = await requestJson(request);
  const expected = requiredTimestamp(body.expected, 'Expected update time');
  const restoring = body.action === 'restore';
  const current = await findInvoice(id, restoring);
  if (!current) throw new ApiError(404, 'Invoice not found');
  if (restoring) {
    if (!canEditInvoice(session, current)) throw new ApiError(403, 'Invoice editing access is required');
    const token = genToken();
    const [restored] = await getSql()`
      UPDATE invoices
      SET archived_at = NULL, share_token = ${token}, updated_at = NOW()
      WHERE id = ${current.id} AND updated_at = ${expected} AND archived_at IS NOT NULL
      RETURNING id::text, invoice_number, archived_at, share_token, updated_at
    `;
    if (!restored[0]) throw new ApiError(409, 'Invoice changed since it was loaded');
    await getSql()`
      INSERT INTO task_activity (user_id, username, actor, action, details)
      VALUES (${session.id}::integer, ${session.username}, ${session.username}, 'invoice_restored',
        ${JSON.stringify({ invoice_id: current.id, invoice_number: current.invoice_number })})
    `;
    return NextResponse.json(restored[0]);
  }
  if (!can(session, 'record_payments')) throw new ApiError(403, 'Payment recording access is required');
  if (current.archived_at) throw new ApiError(404, 'Invoice not found');
  if (!canEditInvoice(session, current)) throw new ApiError(403, 'Invoice editing access is required');
  const { total } = calcInvoiceTotal(current.items, current.tax_rate, current.discount);
  let paymentStatus = body.payment_status === undefined ? current.payment_status : body.payment_status;
  if (paymentStatus === 'partial') paymentStatus = 'partially_paid';
  if (!['unpaid', 'partially_paid', 'paid'].includes(paymentStatus)) throw new ApiError(400, 'Payment status is invalid');
  let amountPaid = body.amount_paid === undefined ? Number(current.amount_paid || 0) : Number(body.amount_paid);
  if (!Number.isFinite(amountPaid) || amountPaid < 0) throw new ApiError(400, 'Amount paid is invalid');
  if (paymentStatus === 'unpaid') amountPaid = 0;
  if (paymentStatus === 'paid') amountPaid = total;
  if (paymentStatus === 'partially_paid' && (amountPaid <= 0 || amountPaid >= total)) {
    throw new ApiError(400, 'Partial payment must be between zero and the invoice total');
  }
  const delta = Math.round((amountPaid - Number(current.amount_paid || 0)) * 100) / 100;
  const [updated] = await getSql()`
    WITH updated AS (
      UPDATE invoices
      SET payment_status = ${paymentStatus}, status = ${paymentStatus}, amount_paid = ${amountPaid}, updated_at = NOW()
      WHERE id = ${current.id} AND updated_at = ${expected} AND archived_at IS NULL
      RETURNING *
    ), payment AS (
      INSERT INTO invoice_payments (invoice_id, amount, actor)
      SELECT id, ${delta}, ${session.username} FROM updated WHERE ${delta} <> 0
      RETURNING invoice_id
    ), activity AS (
      INSERT INTO task_activity (user_id, username, actor, action, details)
      SELECT ${session.id}::integer, ${session.username}, ${session.username}, 'payment_recorded',
        jsonb_build_object('invoice_id', updated.id, 'amount', ${amountPaid}, 'status', ${paymentStatus})::text
      FROM updated
    )
    SELECT * FROM updated
  `;
  if (!updated[0]) throw new ApiError(409, 'Invoice changed since it was loaded');
  return NextResponse.json(updated[0]);
});

export const DELETE = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!canManageInvoices(session)) throw new ApiError(403, 'Invoice management access is required');
  const { id } = await params;
  const permanent = new URL(request.url).searchParams.get('permanent') === '1';
  if (permanent && session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
  const current = await findInvoice(id, permanent);
  if (!current) throw new ApiError(404, 'Invoice not found');
  if (permanent) {
    if (!current.archived_at) throw new ApiError(409, 'Invoice must be archived before permanent deletion');
    await getSql()`
      INSERT INTO task_activity (user_id, username, actor, action, details)
      VALUES (${session.id}::integer, ${session.username}, ${session.username}, 'invoice_deleted',
        ${JSON.stringify({ invoice_id: current.id, invoice_number: current.invoice_number })})
    `;
    await getSql()`DELETE FROM invoices WHERE id = ${current.id}`;
    return NextResponse.json({ ok: true, permanent: true });
  }
  const [archived] = await getSql()`
    UPDATE invoices
    SET archived_at = NOW(), share_token = NULL, updated_at = NOW()
    WHERE id = ${current.id} AND archived_at IS NULL
    RETURNING id::text
  `;
  if (!archived[0]) throw new ApiError(409, 'Invoice was already archived');
  await getSql()`
    INSERT INTO task_activity (user_id, username, actor, action, details)
    VALUES (${session.id}::integer, ${session.username}, ${session.username}, 'invoice_archived',
      ${JSON.stringify({ invoice_id: current.id, invoice_number: current.invoice_number })})
  `;
  return NextResponse.json({ ok: true, permanent: false });
});

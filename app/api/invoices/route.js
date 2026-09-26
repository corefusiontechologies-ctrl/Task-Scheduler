import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { can, canManageInvoices } from '@/lib/access';
import { genToken, getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { normalizeInvoiceInput, validateInvoiceDates } from '@/lib/invoices';
import { monthBounds } from '@/lib/dates';

function serializeInvoice(invoice) {
  return {
    ...invoice,
    id: String(invoice.id),
    invoice_date: invoice.invoice_date,
    issue_date: invoice.issue_date,
    payment_status: invoice.payment_status,
  };
}

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
  ), '[]'::jsonb) AS items,
  COALESCE((
    SELECT SUM(payment.amount)::float8
    FROM invoice_payments payment
    WHERE payment.invoice_id = i.id
      AND payment.paid_at >= $3::date
  ), 0)::float8 AS paid_this_month
`;

export const GET = withApi(async request => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'view_invoices')) throw new ApiError(403, 'Invoice access is required');
  const searchParams = new URL(request.url).searchParams;
  const includeArchived = searchParams.get('archived') === '1';
  const trash = searchParams.get('trash') === '1';
  if ((includeArchived || trash) && !canManageInvoices(session)) throw new ApiError(403, 'Archived invoice access is required');
  const monthStart = monthBounds().start;
  const sql = getSql();
  const invoices = canManageInvoices(session)
    ? await sql(`
        SELECT ${INVOICE_SELECT}
        FROM invoices i
        WHERE ($1::boolean AND i.archived_at IS NOT NULL)
           OR (NOT $1::boolean AND ($2::boolean OR i.archived_at IS NULL))
        ORDER BY i.issue_date DESC, i.id DESC
      `, [trash, includeArchived, monthStart])
    : await sql(`
        SELECT ${INVOICE_SELECT}
        FROM invoices i
        WHERE (($1::boolean AND i.archived_at IS NOT NULL)
           OR (NOT $1::boolean AND ($2::boolean OR i.archived_at IS NULL)))
          AND i.created_by_id = $3
        ORDER BY i.issue_date DESC, i.id DESC
      `, [trash, includeArchived, monthStart, session.id]);
  return NextResponse.json(invoices.map(serializeInvoice), { headers: { 'Cache-Control': 'no-store' } });
});

export const POST = withApi(async request => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'create_invoices')) throw new ApiError(403, 'Invoice creation access is required');
  const body = await requestJson(request);
  const input = normalizeInvoiceInput(body);
  validateInvoiceDates(input.invoice_date, input.due_date);
  const year = Number(input.invoice_date.slice(0, 4));
  const token = genToken();
  const [created] = await getSql()`
    WITH counter AS (
      INSERT INTO invoice_number_counters (year, last_value)
      VALUES (${year}, 1001)
      ON CONFLICT (year) DO UPDATE
        SET last_value = invoice_number_counters.last_value + 1
      RETURNING year, last_value
    ), created AS (
      INSERT INTO invoices (
        invoice_number, client_name, client_email, client_company, client_address,
        project_name, issue_date, invoice_date, due_date, status, payment_status, currency,
        subtotal, tax_rate, tax_amount, discount, total, amount_paid, share_token, notes, terms,
        created_by, created_by_id
      )
      SELECT 'INV-' || counter.year::text || '-' || counter.last_value::text,
        ${input.client_name}, ${input.client_email}, ${input.client_company}, ${input.client_address},
        ${input.project_name}, ${input.invoice_date}, ${input.invoice_date}, ${input.due_date},
        ${input.payment_status}, ${input.payment_status}, ${input.currency},
        ${input.subtotal}, ${input.tax_rate}, ${input.tax_amount}, ${input.discount}, ${input.total},
        ${input.amount_paid}, ${token},
        ${input.notes}, ${input.terms}, ${session.username}, ${session.id}::integer
      FROM counter
      RETURNING *
    ), item_rows AS (
      INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
      SELECT created.id, item.description, item.quantity, item.unit_price, item.amount
      FROM created
      CROSS JOIN jsonb_to_recordset(${JSON.stringify(input.items)}::jsonb)
        AS item(description text, quantity numeric, unit_price numeric, amount numeric)
      RETURNING invoice_id
    ), payment AS (
      INSERT INTO invoice_payments (invoice_id, amount, actor)
      SELECT id, ${input.amount_paid}, ${session.username}
      FROM created
      WHERE ${input.amount_paid} <> 0
      RETURNING invoice_id
    ), activity AS (
      INSERT INTO task_activity (user_id, username, actor, action, details)
      SELECT ${session.id}::integer, ${session.username}, ${session.username}, 'invoice_created',
        jsonb_build_object('invoice_id', id, 'invoice_number', invoice_number, 'client_name', client_name)::text
      FROM created
    )
    SELECT * FROM created
  `;
  return NextResponse.json(serializeInvoice({
    ...created,
    invoice_date: created.issue_date,
    items: input.items,
    paid_this_month: input.amount_paid,
  }), { status: 201 });
});

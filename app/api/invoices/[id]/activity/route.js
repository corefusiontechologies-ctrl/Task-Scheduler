import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { can, canManageInvoices } from '@/lib/access';
import { getSql } from '@/lib/db';
import { ApiError, withApi } from '@/lib/http';

export const GET = withApi(async (request, { params }) => {
  void request;
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'view_invoices')) throw new ApiError(403, 'Invoice access is required');
  const { id } = await params;
  const sql = getSql();
  const invoiceRows = await sql`
    SELECT id::text, invoice_number, created_by_id::text
    FROM invoices
    WHERE id = ${id} AND archived_at IS NULL
  `;
  const invoice = invoiceRows[0];
  if (!invoice) throw new ApiError(404, 'Invoice not found');
  if (!canManageInvoices(session) && String(invoice.created_by_id) !== String(session.id)) {
    throw new ApiError(404, 'Invoice not found');
  }
  const activity = await sql`
    SELECT id::text, user_id::text, username, actor, action, details, created_at
    FROM task_activity
    WHERE details->>'invoice_id' = ${String(id)}
    ORDER BY created_at DESC, id DESC
    LIMIT 200
  `;
  return NextResponse.json(activity, { headers: { 'Cache-Control': 'no-store' } });
});

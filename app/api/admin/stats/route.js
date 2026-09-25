import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { getSql } from '@/lib/db';
import { ApiError, withApi } from '@/lib/http';
import { addDays, businessDate, monthBounds } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export const GET = withApi(async () => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
  const today = businessDate();
  const weekEnd = addDays(today, 7);
  const monthStart = monthBounds().start;
  const sql = getSql();
  const [completed] = await sql`
    SELECT COUNT(*)::int AS count
    FROM tasks
    WHERE status = 'done' AND archived_at IS NULL
      AND updated_at >= date_trunc('week', ${today}::date)::date
  `;
  const [overdue] = await sql`
    SELECT COUNT(*)::int AS count
    FROM tasks
    WHERE status <> 'done' AND archived_at IS NULL AND due_date < ${today}::date
  `;
  const [dueThisWeek] = await sql`
    SELECT COUNT(*)::int AS count
    FROM tasks
    WHERE status <> 'done' AND archived_at IS NULL
      AND due_date >= ${today}::date AND due_date < ${weekEnd}::date
  `;
  const [active] = await sql`
    SELECT COUNT(*)::int AS count
    FROM tasks
    WHERE status <> 'done' AND archived_at IS NULL
  `;
  const [unpaid] = await sql`
    SELECT COUNT(*)::int AS count
    FROM invoices
    WHERE archived_at IS NULL AND payment_status <> 'paid'
  `;
  const revenue = await sql`
    SELECT invoice.currency,
      COALESCE(SUM((
        SELECT SUM(payment.amount)
        FROM invoice_payments payment
        WHERE payment.invoice_id = invoice.id AND payment.paid_at >= ${monthStart}::date
      )), 0)::float8 AS collected_this_month,
      COUNT(*)::int AS invoices_this_month
    FROM invoices invoice
    WHERE invoice.archived_at IS NULL AND invoice.issue_date >= ${monthStart}::date
    GROUP BY invoice.currency
    ORDER BY invoice.currency
  `;
  return NextResponse.json({
    tasksCompletedThisWeek: completed.count,
    overdueCount: overdue.count,
    dueThisWeekCount: dueThisWeek.count,
    activeTaskCount: active.count,
    unpaidInvoiceCount: unpaid.count,
    revenueByCurrency: revenue.map(row => ({
      currency: row.currency,
      collectedThisMonth: Number(row.collected_this_month || 0),
      invoicesThisMonth: row.invoices_this_month,
    })),
  });
});

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runInvoiceReminderJob } from '../../../../lib/reminders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization') || '';
  if (!secret || provided.length !== `Bearer ${secret}`.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(`Bearer ${secret}`));
}

export async function GET(request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await runInvoiceReminderJob();
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Invoice reminder job failed' }, { status: 500 });
  }
}

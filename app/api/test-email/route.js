import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { emailConfigStatus, sendEmail, safeAppUrl } from '../../../lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization') || '';
  if (!secret || provided.length !== `Bearer ${secret}`.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(`Bearer ${secret}`));
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function validRecipient(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

/**
 * Diagnostic endpoint for the Resend integration.
 *
 * Deliberately hard to abuse: requires CRON_SECRET, and refuses to send in
 * production unless ALLOW_TEST_EMAIL=1 is set explicitly. Sending to a real
 * client is what the cron jobs are for.
 */
export async function GET(request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  if (!authorized(request)) return unauthorized();

  const email = emailConfigStatus();
  return NextResponse.json(
    {
      ready: email.ready,
      missing: email.missing,
      senderConfigured: Boolean(process.env.RESEND_FROM || process.env.RESEND_FROM_EMAIL),
      appUrl: process.env.APP_URL || null,
      canSend: email.ready && (isProduction() ? process.env.ALLOW_TEST_EMAIL === '1' : true),
      sendBlockedInProduction: isProduction() && process.env.ALLOW_TEST_EMAIL !== '1',
      hint: 'POST ?to=you@example.com to send a real test message',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  if (!authorized(request)) return unauthorized();

  if (isProduction() && process.env.ALLOW_TEST_EMAIL !== '1') {
    return NextResponse.json(
      { error: 'Test sending is disabled in production. Set ALLOW_TEST_EMAIL=1 to enable it deliberately.' },
      { status: 403 },
    );
  }

  const email = emailConfigStatus();
  if (!email.ready) {
    return NextResponse.json(
      { error: `Email is not configured: ${email.missing.join(', ')}` },
      { status: 503 },
    );
  }

  const to = new URL(request.url).searchParams.get('to');
  if (!validRecipient(to)) {
    return NextResponse.json({ error: 'Provide ?to=<valid email address>' }, { status: 400 });
  }

  let link;
  try {
    link = safeAppUrl('/login', process.env.APP_URL || 'http://localhost:3000');
  } catch {
    link = null;
  }

  try {
    const result = await sendEmail({
      to,
      subject: 'CoreFusion email test',
      text: `This is a test message from your Task Scheduler. If you are reading it, email delivery works.`,
      html: `<div style="font-family:Arial,sans-serif;color:#272521"><h2>Email delivery works</h2><p>This is a test message from your Task Scheduler. If you can read this, the Resend integration is working.</p>${link ? `<p><a href="${link}">Open your dashboard</a></p>` : ''}</div>`,
      idempotencyKey: `test-email-${Date.now()}`,
    });
    return NextResponse.json(
      { ok: true, id: result?.id || null, to, note: 'Accepted by Resend. Check the inbox and spam folder.' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const detail = String(err instanceof Error ? err.message : err);
    console.error('[test-email]', detail);
    return NextResponse.json(
      { error: 'Send failed', detail },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

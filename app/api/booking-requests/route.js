import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { businessDate } from '@/lib/dates';
import { checkPublicRateLimit, publicClientKey } from '@/lib/publicRateLimit';
import { bookingInsertValues, validateBookingRequest, HONEYPOT_FIELD, MAX_SUBMISSIONS_PER_IP_PER_DAY } from '@/lib/bookingRequests';
import { optionalId } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// Booking requests from the public availability page.
//
// This POST is unauthenticated, so it carries the extra weight every open
// endpoint should: a honeypot, an in-memory pre-filter to avoid hammering the
// database, and a real per-IP limit counted from the table itself. It also
// never reveals client or schedule details - the reply is a generic
// acknowledgement, not an echo of the calendar.

function requireBookingManager(session) {
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!session.can('manage_booking_requests')) throw new ApiError(403, 'Permission required');
}

/**
 * List booking requests for the dashboard.
 */
export const GET = withApi(async (request) => {
  const session = await getFreshSession();
  requireBookingManager(session);
  const sql = getSql();

  // ?status= filters to one column; ?id= opens a single record.
  const url = new URL(request.url);
  const singleId = optionalId(url.searchParams.get('id'), 'Request ID');
  const status = url.searchParams.get('status');
  const includeArchived = url.searchParams.get('archived') === '1';
  if (status && !['new', 'confirmed', 'declined'].includes(status)) {
    throw new ApiError(400, 'Unknown status filter');
  }

  const rows = singleId
    ? await sql`
        SELECT id::text, requested_date::text, name, email, phone, company, service,
               message, note, status, source, created_at, handled_at, handled_by, archived_at
        FROM booking_requests
        WHERE id = ${singleId}
        LIMIT 1
      `
    : await sql`
        SELECT id::text, requested_date::text, name, email, phone, company, service,
               message, note, status, source, created_at, handled_at, handled_by, archived_at
        FROM booking_requests
        WHERE (${includeArchived} OR archived_at IS NULL)
          AND (${status || null}::varchar IS NULL OR status = ${status || null})
        ORDER BY (status = 'new') DESC, requested_date ASC, id ASC
        LIMIT 500
      `;

  return NextResponse.json(
    { requests: rows, count: rows.length },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

/**
 * Public submission from the availability page.
 *
 * A duplicate open request for the same date and address returns the existing
 * record with 200 rather than an error, so a double-click or a retried POST
 * reads as success to the visitor instead of a failure.
 */
export const POST = withApi(async (request) => {
  const sql = getSql();
  const ip = publicClientKey(request);
  const body = await requestJson(request);

  // Honeypot: answered like a success but never written, so a bot filling
  // every input learns nothing from the response.
  if (typeof body?.[HONEYPOT_FIELD] === 'string' && body[HONEYPOT_FIELD].trim() !== '') {
    return NextResponse.json({ ok: true, status: 'new' }, { status: 202 });
  }

  // Cheap in-memory gate first: keeps a burst from reaching the database at
  // all. The database count below is the limit that actually counts.
  const burst = checkPublicRateLimit(request, 10, 10 * 60 * 1000);
  if (burst.limited) {
    return NextResponse.json(
      { error: 'Too many requests from this connection. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(burst.retryAfterSeconds) } },
    );
  }

  const recent = await sql`
    SELECT COUNT(*)::int AS count
    FROM booking_requests
    WHERE ip = ${ip}
      AND created_at > NOW() - INTERVAL '1 day'
  `;
  if ((recent[0]?.count || 0) >= MAX_SUBMISSIONS_PER_IP_PER_DAY) {
    return NextResponse.json(
      { error: 'Too many requests from this connection. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    );
  }

  const values = bookingInsertValues(validateBookingRequest(body, { today: businessDate() }));

  const inserted = await sql`
    INSERT INTO booking_requests
      (requested_date, name, email, phone, company, service, message, source, ip)
    VALUES
      (${values.requestedDate}, ${values.name}, ${values.email}, ${values.phone},
       ${values.company}, ${values.service}, ${values.message}, 'availability', ${ip})
    ON CONFLICT DO NOTHING
    RETURNING id::text, requested_date::text, status
  `;

  if (inserted[0]) {
    return NextResponse.json(
      {
        ok: true,
        status: inserted[0].status,
        requestedDate: inserted[0].requested_date,
        id: inserted[0].id,
      },
      { status: 201 },
    );
  }

  // The partial unique index already refused the row: this address has an open
  // request for that date. Report it as accepted so a retried submit is not
  // shown as an error.
  return NextResponse.json({ ok: true, status: 'new', duplicate: true }, { status: 200 });
});
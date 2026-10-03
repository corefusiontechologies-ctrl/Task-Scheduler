import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { BOOKING_STATUSES } from '@/lib/bookingRequests';
import { oneOf, requiredId, optionalString } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// Confirming or declining a booking request is a commercial decision, so it
// sits behind its own `manage_booking_requests` permission rather than the
// `manage_availability` one that staff hold for working the calendar.

function requireBookingManager(session) {
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!session.can('manage_booking_requests')) throw new ApiError(403, 'Permission required');
}

/**
 * Move a request to confirmed / declined / back to new, optionally noting why.
 *
 * Set `archived: true` to remove a request from the working list without
 * deleting the record.
 */
export const PATCH = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  requireBookingManager(session);
  const { id } = await params;
  const requestId = requiredId(id, 'Request ID');
  const body = await requestJson(request);
  const status = oneOf(body.status, 'Status', BOOKING_STATUSES);
  const note = optionalString(body.note, 'Note', { max: 500 });
  const archive = body.archived === true;

  const sql = getSql();
  const target = await sql`
    SELECT id::text, status, requested_date::text, name
    FROM booking_requests
    WHERE id = ${requestId} AND archived_at IS NULL
    LIMIT 1
  `;
  if (!target[0]) throw new ApiError(404, 'Booking request not found');

  // A note is only meaningful alongside a decision, so it is stored when given
  // and left alone when the body omits it.
  const updated = await sql`
    UPDATE booking_requests
    SET status = ${status},
        note = COALESCE(${note}, note),
        handled_at = ${status === 'new' ? null : new Date().toISOString()},
        handled_by = ${status === 'new' ? null : session.username},
        archived_at = ${archive ? new Date().toISOString() : null},
        updated_at = NOW()
    WHERE id = ${requestId}
    RETURNING id::text, requested_date::text, name, email, phone, company, service,
              message, note, status, created_at, handled_at, handled_by, archived_at
  `;
  if (!updated[0]) throw new ApiError(404, 'Booking request not found');

  return NextResponse.json({ request: updated[0] }, { headers: { 'Cache-Control': 'no-store' } });
});
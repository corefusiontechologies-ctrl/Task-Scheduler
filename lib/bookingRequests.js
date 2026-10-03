import { ValidationError, normalizeEmail, optionalString, requireObject, requiredDate, requiredString } from './validation';
import { addDays } from './dates';

// A booking request comes from an unauthenticated public page, so every rule
// here is enforced server side and the UI is only a convenience.

/** Throttle per IP, counted from the booking_requests table itself so the
 *  limit survives a cold start or a second server instance. */
export const MAX_SUBMISSIONS_PER_IP_PER_DAY = 5;
export const RATE_LIMIT_WINDOW_DAYS = 1;

/** How far ahead someone may ask for a date (~18 months). */
export const BOOKING_HORIZON_DAYS = 548;

export const BOOKING_STATUSES = ['new', 'confirmed', 'declined'];

/** Suggestions offered in the form. Stored as free text so a request that
 *  names something else is still accepted rather than rejected. */
export const SERVICE_SUGGESTIONS = [
  'New website',
  'Web or mobile app',
  'System integration',
  'Maintenance or support',
  'Consultation',
  'Something else',
];

/** Honeypot: a real visitor never sees or fills this. Bots that post every
 *  input do, and the submission is dropped. */
export const HONEYPOT_FIELD = 'website_url';

const PHONE_PATTERN = /^[+()\d\s-]{7,25}$/;

function isRealCalendarDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validates and normalises a public booking request.
 *
 * @param {unknown} body raw request body
 * @param {{ today: string }} context business "today" as YYYY-MM-DD
 * @returns {{requestedDate: string, name: string, email: string|null,
 *           phone: string|null, company: string, service: string, message: string}}
 */
export function validateBookingRequest(body, { today }) {
  const data = requireObject(body, 'Booking request');

  if (typeof data[HONEYPOT_FIELD] === 'string' && data[HONEYPOT_FIELD].trim() !== '') {
    throw new ValidationError('Booking request is invalid', { [HONEYPOT_FIELD]: 'Rejected' });
  }

  const requestedDate = requiredDate(data.requested_date, 'Requested date');
  if (!isRealCalendarDate(requestedDate)) {
    throw new ValidationError('Requested date is invalid', { requested_date: 'Use YYYY-MM-DD' });
  }
  if (requestedDate < today) {
    throw new ValidationError('Requested date is in the past', { requested_date: 'Choose today or a later date' });
  }
  if (requestedDate > addDays(today, BOOKING_HORIZON_DAYS)) {
    throw new ValidationError('Requested date is too far ahead', {
      requested_date: `Choose a date within ${Math.round(BOOKING_HORIZON_DAYS / 30)} months`,
    });
  }

  const name = requiredString(data.name, 'Name', { min: 2, max: 150 });

  // Either address works, but at least one is needed to reply to.
  const email = normalizeEmail(data.email, 'Email');
  let phone = optionalString(data.phone, 'Phone', { min: 7, max: 25 });
  if (phone !== null) {
    phone = phone.replace(/\s+/g, ' ');
    if (!PHONE_PATTERN.test(phone)) {
      throw new ValidationError('Phone is not a valid number', { phone: 'Enter a valid phone number' });
    }
  }
  if (!email && !phone) {
    throw new ValidationError('An email address or phone number is required', {
      email: 'Add an email address or a phone number',
    });
  }

  return {
    requestedDate,
    name,
    email,
    phone,
    company: optionalString(data.company, 'Company', { max: 255 }) ?? '',
    service: optionalString(data.service, 'Service', { max: 100 }) ?? '',
    message: optionalString(data.message, 'Message', { max: 2000 }) ?? '',
  };
}

/** Maps a validateBookingRequest result onto booking_requests columns. */
export function bookingInsertValues(clean) {
  return {
    requestedDate: clean.requestedDate,
    name: clean.name,
    email: clean.email ?? '',
    phone: clean.phone ?? '',
    company: clean.company,
    service: clean.service,
    message: clean.message,
  };
}
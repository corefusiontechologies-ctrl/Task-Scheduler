import { describe, expect, it } from 'vitest';
import { safeCsvCell } from '../lib/csv.js';
import { businessDate, daysBetween, monthBounds } from '../lib/dates.js';
import { calcInvoiceTotal, normalizePaymentStatus, resolveAmountPaid } from '../lib/invoiceMath.js';
import { normalizeTaskInput } from '../lib/tasks.js';
import { requiredDate, requiredId } from '../lib/validation.js';
import { addImpliedPermissions, legacyFlags, resolvePermissions } from '../lib/permissions.js';
import { bookingInsertValues, validateBookingRequest } from '../lib/bookingRequests.js';

const task = {
  title: 'Review launch checklist',
  start_date: '2026-09-25',
  due_date: '2026-09-26',
};

describe('invoice calculations', () => {
  it('calculates rounded line totals, tax, and discount', () => {
    const result = calcInvoiceTotal([
      { quantity: 2, unit_price: 19.995 },
      { quantity: 1, unit_price: 10 },
    ], 10, 5);

    expect(result.subtotal).toBe(50);
    expect(result.tax).toBe(5);
    expect(result.total).toBe(50);
    expect(result.items[0].amount).toBe(40);
  });

  it('caps partial payments and derives payment status', () => {
    expect(resolveAmountPaid([{ quantity: 1, unit_price: 100 }], 0, 0, 'partially_paid', 35)).toBe(35);
    expect(resolveAmountPaid([{ quantity: 1, unit_price: 100 }], 0, 0, 'partially_paid', 150)).toBe(100);
    expect(normalizePaymentStatus('unpaid', 35, 100)).toBe('partially_paid');
    expect(normalizePaymentStatus('unpaid', 100, 100)).toBe('paid');
  });
});

describe('CSV protection', () => {
  it('neutralizes spreadsheet formulas and preserves commas and quotes', () => {
    expect(safeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(safeCsvCell('+1')).toBe("'+1");
    expect(safeCsvCell('a,b')).toBe('"a,b"');
    expect(safeCsvCell('a"b')).toBe('"a""b"');
    expect(safeCsvCell(null)).toBe('');
  });
});

describe('task normalization', () => {
  it('normalizes legacy values and forces completed tasks to 100 percent', () => {
    const result = normalizeTaskInput({ ...task, priority: 'normal', status: 'done', progress: 0 });
    expect(result.priority).toBe('medium');
    expect(result.status).toBe('done');
    expect(result.progress).toBe(100);
  });

  it('rejects inverted dates', () => {
    expect(() => normalizeTaskInput({ ...task, due_date: '2026-09-24' })).toThrow('Due date must be on or after the start date');
  });
});

describe('date and ID validation', () => {
  it('uses calendar arithmetic independent of daylight-saving transitions', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(monthBounds(new Date('2026-12-31T12:00:00Z')).end).toBe('2027-01-01');
  });

  it('accepts valid identifiers and rejects malformed values', () => {
    expect(requiredId('42', 'ID')).toBe(42);
    expect(() => requiredId('4.2', 'ID')).toThrow('ID is invalid');
    expect(requiredDate('2024-02-29', 'Date')).toBe('2024-02-29');
    expect(() => requiredDate('2026-02-30', 'Date')).toThrow('Date is invalid');
  });

  it('honors the configured business timezone', () => {
    const previous = process.env.APP_TIMEZONE;
    process.env.APP_TIMEZONE = 'UTC';
    expect(businessDate(new Date('2026-01-01T00:30:00.000Z'))).toBe('2026-01-01');
    if (previous === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = previous;
  });
});

describe('implied permissions', () => {
  it('grants the base view permission alongside any task permission', () => {
    expect(addImpliedPermissions(['create_tasks'])).toContain('view_tasks');
    expect(addImpliedPermissions(['edit_own_tasks'])).toContain('view_tasks');
    expect(addImpliedPermissions(['manage_team'])).toContain('view_team');
    expect(addImpliedPermissions(['record_payments'])).toContain('view_invoices');
  });

  it('expands manage_invoices into its component permissions', () => {
    const result = addImpliedPermissions(['manage_invoices']);
    expect(result).toEqual(expect.arrayContaining(['create_invoices', 'edit_invoices', 'record_payments']));
  });

  it('does not grant anything from an empty set and is idempotent', () => {
    expect(addImpliedPermissions([])).toEqual([]);
    expect(addImpliedPermissions(['view_tasks'])).toEqual(['view_tasks']);
    expect(addImpliedPermissions(addImpliedPermissions(['manage_invoices']))).toEqual(
      addImpliedPermissions(['manage_invoices']),
    );
  });

  it('maps the legacy boolean mirrors from the real permission list', () => {
    const flags = legacyFlags(['create_tasks', 'view_invoices']);
    expect(flags.perm_add_tasks).toBe(true);
    expect(flags.perm_manage_invoices).toBe(false);
    expect(flags.perm_view_all_tasks).toBe(false);
  });
});

describe('per-user permission overrides', () => {
  it('returns the role permissions when there are no overrides', () => {
    expect(resolvePermissions(['view_tasks', 'create_tasks'], [], []))
      .toEqual(['create_tasks', 'view_tasks']);
  });

  it('allows a permission the role does not grant, with its implications', () => {
    const result = resolvePermissions([], ['create_tasks'], []);
    // create_tasks implies view_tasks, otherwise the user could create work
    // they are unable to see.
    expect(result).toEqual(expect.arrayContaining(['create_tasks', 'view_tasks']));
  });

  it('denies a permission the role does grant', () => {
    const result = resolvePermissions(['view_tasks', 'create_tasks', 'edit_tasks'], [], ['edit_tasks']);
    expect(result).not.toContain('edit_tasks');
    expect(result).toContain('create_tasks');
  });

  it('lets deny win over allow for the same permission', () => {
    const result = resolvePermissions([], ['manage_invoices'], ['manage_invoices']);
    expect(result).not.toContain('manage_invoices');
    // The implied permissions must not sneak the umbrella back in either.
    expect(result).not.toContain('create_invoices');
    expect(result).not.toContain('view_invoices');
  });

  it('keeps a denied base permission denied even when a child is allowed', () => {
    // Allowing create_tasks implies view_tasks; denying view_tasks must
    // survive that final implication pass rather than being re-added.
    const result = resolvePermissions([], ['create_tasks'], ['view_tasks']);
    expect(result).toContain('create_tasks');
    expect(result).not.toContain('view_tasks');
  });

  it('does not let denying a permission leave an orphaned child', () => {
    // Denying view_invoices must not leave record_payments in the set, since
    // record_payments is meaningless without being able to view invoices.
    const result = resolvePermissions(['view_invoices', 'record_payments'], [], ['view_invoices']);
    expect(result).not.toContain('view_invoices');
  });

  it('treats an absent override set as unrestricted', () => {
    expect(resolvePermissions()).toEqual([]);
    expect(resolvePermissions(undefined, undefined, undefined)).toEqual([]);
  });

  it('returns a sorted, duplicate-free list', () => {
    const result = resolvePermissions(['view_tasks'], ['view_tasks', 'edit_tasks'], []);
    expect(result).toEqual(['edit_tasks', 'view_tasks']);
  });
});

describe('public booking requests', () => {
  const today = '2026-09-25';
  const ctx = { today };
  const valid = {
    requested_date: '2026-10-02',
    name: 'Dana Reyes',
    email: 'Dana@Example.com',
    message: 'New marketing site.',
  };

  it('normalises a valid request and lowercases the email', () => {
    const result = validateBookingRequest(valid, ctx);
    expect(result).toMatchObject({
      requestedDate: '2026-10-02',
      name: 'Dana Reyes',
      email: 'dana@example.com',
      phone: null,
      company: '',
      service: '',
      message: 'New marketing site.',
    });
  });

  it('accepts a phone number instead of an email', () => {
    const result = validateBookingRequest(
      { requested_date: '2026-10-02', name: 'Dana Reyes', phone: '+92 300 1234567' },
      ctx,
    );
    expect(result.phone).toBe('+92 300 1234567');
    expect(result.email).toBeNull();
  });

  it('requires at least one way to reply', () => {
    expect(() => validateBookingRequest({ ...valid, email: '' }, ctx))
      .toThrow(/email address or phone number/i);
  });

  it('rejects a date in the past', () => {
    expect(() => validateBookingRequest({ ...valid, requested_date: '2026-09-24' }, ctx))
      .toThrow(/in the past/i);
  });

  it('accepts today itself', () => {
    expect(validateBookingRequest({ ...valid, requested_date: today }, ctx).requestedDate).toBe(today);
  });

  it('rejects a date beyond the booking horizon', () => {
    expect(() => validateBookingRequest({ ...valid, requested_date: '2040-01-01' }, ctx))
      .toThrow(/too far ahead/i);
  });

  it('rejects an impossible calendar date rather than storing garbage', () => {
    // requiredDate validates the shape; this guards the round-trip.
    expect(() => validateBookingRequest({ ...valid, requested_date: '2026-02-30' }, ctx)).toThrow();
  });

  it('rejects a malformed address and a malformed number', () => {
    expect(() => validateBookingRequest({ ...valid, email: 'not-an-email' }, ctx)).toThrow(/valid address/i);
    expect(() => validateBookingRequest({ ...valid, email: '', phone: 'call me' }, ctx)).toThrow(/valid number/i);
  });

  it('rejects a filled honeypot', () => {
    expect(() => validateBookingRequest({ ...valid, website_url: 'http://spam.example' }, ctx)).toThrow();
  });

  it('rejects an over-long message instead of silently truncating', () => {
    expect(() => validateBookingRequest({ ...valid, message: 'x'.repeat(2001) }, ctx)).toThrow();
  });

  it('maps cleaned values onto the database columns', () => {
    const values = bookingInsertValues(validateBookingRequest({ ...valid, phone: '' }, ctx));
    expect(values).toMatchObject({
      requestedDate: '2026-10-02',
      email: 'dana@example.com',
      phone: '',
      company: '',
    });
  });
});

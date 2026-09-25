import { describe, expect, it } from 'vitest';
import { safeCsvCell } from '../lib/csv.js';
import { businessDate, daysBetween, monthBounds } from '../lib/dates.js';
import { calcInvoiceTotal, normalizePaymentStatus, resolveAmountPaid } from '../lib/invoiceMath.js';
import { normalizeTaskInput } from '../lib/tasks.js';
import { requiredDate, requiredId } from '../lib/validation.js';

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

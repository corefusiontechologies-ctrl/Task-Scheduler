import { daysBetween } from './dates';
import { ApiError } from './http';
import { calcInvoiceTotal, normalizePaymentStatus, resolveAmountPaid } from './invoiceMath';
import { oneOf, optionalString, requiredDate, requiredNumber, requiredString } from './validation';

export const INVOICE_PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function text(value, field, max, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return requiredString(value, field, { min: 0, max, trim: false });
}

function itemInput(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError(400, `Item ${index + 1} is invalid`);
  const description = requiredString(item.description, `Item ${index + 1} description`, { min: 1, max: 1000 });
  const quantity = requiredNumber(item.quantity ?? 1, `Item ${index + 1} quantity`, { min: 0.01, max: 1000000 });
  const unitPrice = requiredNumber(item.unit_price ?? item.unitPrice ?? 0, `Item ${index + 1} unit price`, { min: 0, max: 999999999999.99 });
  return { description, quantity, unit_price: unitPrice };
}

export function normalizeInvoiceInput(body, current = {}) {
  const invoiceDateValue = 'invoice_date' in body ? body.invoice_date : 'issue_date' in body ? body.issue_date : current.invoice_date || current.issue_date;
  const rawItems = 'items' in body ? body.items : current.items || [];
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 100) {
    throw new ApiError(400, 'Invoices must contain between 1 and 100 items');
  }
  const items = rawItems.map(itemInput);
  const taxRate = requiredNumber(body.tax_rate ?? current.tax_rate ?? 0, 'Tax rate', { min: 0, max: 100 });
  const discount = requiredNumber(body.discount ?? current.discount ?? 0, 'Discount', { min: 0, max: 999999999999.99 });
  const { subtotal, tax, total } = calcInvoiceTotal(items, taxRate, discount);
  if (total <= 0) throw new ApiError(400, 'Invoice total must be greater than zero');
  if (discount > subtotal + tax) throw new ApiError(400, 'Discount cannot exceed subtotal plus tax');
  const requestedStatus = oneOf(body.payment_status ?? current.payment_status ?? 'unpaid', 'Payment status', INVOICE_PAYMENT_STATUSES);
  const amountPaid = resolveAmountPaid(items, taxRate, discount, requestedStatus, body.amount_paid ?? current.amount_paid ?? 0);
  const paymentStatus = normalizePaymentStatus(requestedStatus, amountPaid, total);
  if (requestedStatus === 'partially_paid' && (amountPaid <= 0 || amountPaid >= total)) {
    throw new ApiError(400, 'Partially paid invoices require a payment between zero and the total');
  }
  return {
    client_name: requiredString(body.client_name ?? current.client_name, 'Client name', { min: 1, max: 255 }),
    client_email: requiredString(body.client_email ?? current.client_email, 'Client email', { min: 3, max: 254, pattern: EMAIL_PATTERN }).toLowerCase(),
    client_company: text(body.client_company ?? current.client_company, 'Client company', 255),
    client_address: text(body.client_address ?? current.client_address, 'Client address', 2000),
    project_name: text(body.project_name ?? current.project_name, 'Project name', 255),
    invoice_date: requiredDate(invoiceDateValue, 'Invoice date'),
    due_date: requiredDate(body.due_date ?? current.due_date, 'Due date'),
    currency: requiredString(body.currency ?? current.currency ?? 'USD', 'Currency', { min: 3, max: 3, pattern: CURRENCY_PATTERN }).toUpperCase(),
    subtotal,
    tax_amount: tax,
    tax_rate: taxRate,
    discount,
    payment_status: paymentStatus,
    amount_paid: amountPaid,
    notes: optionalString(body.notes ?? current.notes, 'Notes', { min: 0, max: 10000 }) || '',
    terms: optionalString(body.terms ?? current.terms, 'Terms', { min: 0, max: 10000 }) || '',
    items,
    total,
  };
}

export function validateInvoiceDates(invoiceDate, dueDate) {
  if (daysBetween(invoiceDate, dueDate) < 0) throw new ApiError(400, 'Due date must be on or after the invoice date');
}

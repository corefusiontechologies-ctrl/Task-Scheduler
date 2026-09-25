function rounded(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function calcInvoiceTotal(items = [], taxRate = 0, discount = 0) {
  const normalizedItems = (Array.isArray(items) ? items : []).map(item => {
    const quantity = rounded(item.quantity);
    const unitPrice = rounded(item.unit_price);
    return { ...item, quantity, unit_price: unitPrice, amount: rounded(quantity * unitPrice) };
  });
  const subtotal = rounded(normalizedItems.reduce((sum, item) => sum + item.amount, 0));
  const tax = rounded(subtotal * (Number(taxRate || 0) / 100));
  const total = rounded(Math.max(0, subtotal + tax - Number(discount || 0)));
  return { items: normalizedItems, subtotal, tax, total };
}

export function calculateInvoiceTotals(invoice = {}) {
  const result = calcInvoiceTotal(invoice.items || [], invoice.tax_rate || 0, invoice.discount || 0);
  return {
    subtotal: result.subtotal,
    taxAmount: result.tax,
    discount: rounded(invoice.discount || 0),
    total: result.total,
  };
}

export function resolveAmountPaid(items, taxRate, discount, paymentStatus, requestedAmount) {
  const { total } = calcInvoiceTotal(items, taxRate, discount);
  const status = paymentStatus === 'partial' ? 'partially_paid' : paymentStatus;
  if (status === 'paid') return total;
  if (status === 'partially_paid') {
    return Math.min(total, Math.max(0, rounded(requestedAmount)));
  }
  return 0;
}

export function normalizePaymentStatus(paymentStatus, amountPaid, total) {
  if (paymentStatus === 'paid' || amountPaid >= total && total > 0) return 'paid';
  if (amountPaid > 0) return 'partially_paid';
  return 'unpaid';
}

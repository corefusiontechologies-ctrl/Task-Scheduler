function sender() {
  const configured = process.env.RESEND_FROM || process.env.RESEND_FROM_EMAIL;
  if (!configured) throw new Error('RESEND_FROM is not configured');
  return configured;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeAppUrl(path, requestOrigin) {
  const configured = process.env.APP_URL || (process.env.NODE_ENV === 'production' ? '' : requestOrigin);
  if (!configured) throw new Error('APP_URL is not configured');
  const base = new URL(configured);
  if (base.protocol !== 'https:' && process.env.NODE_ENV === 'production') throw new Error('APP_URL must use HTTPS');
  const requested = new URL(path, base);
  if (requested.origin !== base.origin) throw new Error('Unsafe application URL');
  return requested.toString();
}

export async function sendEmail({ to, subject, text, html, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Invalid recipient email');
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 256);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: sender(),
      to: [to],
      subject: String(subject).slice(0, 200),
      text: String(text).slice(0, 100000),
      html: String(html).slice(0, 200000),
    }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Email delivery failed with status ${response.status}`);
  return result;
}

function emailLayout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f5f3ef;font-family:Arial,sans-serif;color:#272521"><div style="max-width:600px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #dedbd5;border-radius:12px;padding:28px"><h1 style="margin:0 0 20px;font-size:22px">${escapeHtml(title)}</h1>${bodyHtml}</div></div></body></html>`;
}

export async function sendTaskReminder({ recipient, recipientName, task, kind, idempotencyKey }) {
  const subject = kind === 'overdue'
    ? `Overdue task: ${task.title}`
    : `Task due soon: ${task.title}`;
  const timing = kind === 'overdue' ? `was due ${task.due_date}` : `is due ${task.due_date}`;
  const taskUrl = task.share_token ? safeAppUrl(`/client/${encodeURIComponent(task.share_token)}`) : safeAppUrl('/dashboard');
  const dashboardUrl = safeAppUrl('/dashboard');
  const destination = task.share_token ? taskUrl : dashboardUrl;
  const text = `${task.title}\n${task.client_name}\nThis task ${timing}.\n\nView task: ${destination}`;
  const html = emailLayout(subject, `
    <p>Hello ${escapeHtml(recipientName || 'there')},</p>
    <p><strong>${escapeHtml(task.title)}</strong> for ${escapeHtml(task.client_name)} ${escapeHtml(timing)}.</p>
    <p><a href="${escapeHtml(destination)}" style="display:inline-block;background:#b94b22;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none">View task</a></p>
    <p style="font-size:12px;color:#666">You received this reminder because you are associated with this task.</p>
  `);
  return sendEmail({ to: recipient, subject, text, html, idempotencyKey });
}

export async function sendInvoiceReminder({ invoice, kind, idempotencyKey }) {
  const subject = kind === 'overdue'
    ? `Overdue invoice ${invoice.invoice_number}`
    : `Invoice due soon: ${invoice.invoice_number}`;
  const timing = kind === 'overdue' ? `was due ${invoice.due_date}` : `is due ${invoice.due_date}`;
  const invoiceUrl = safeAppUrl(`/invoice/${encodeURIComponent(invoice.share_token)}`);
  const text = `Invoice ${invoice.invoice_number}\nThis invoice ${timing}.\nTotal: ${invoice.currency} ${invoice.total}\n\nView invoice: ${invoiceUrl}`;
  const html = emailLayout(subject, `
    <p>Hello ${escapeHtml(invoice.client_name)},</p>
    <p>Invoice <strong>${escapeHtml(invoice.invoice_number)}</strong> ${escapeHtml(timing)}.</p>
    <p>Total: ${escapeHtml(invoice.currency)} ${escapeHtml(invoice.total)}</p>
    <p><a href="${escapeHtml(invoiceUrl)}" style="display:inline-block;background:#b94b22;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none">View invoice</a></p>
  `);
  return sendEmail({ to: invoice.client_email, subject, text, html, idempotencyKey });
}

export async function sendTaskAssigned(task, recipientEmail, requestOrigin) {
  const url = safeAppUrl(`/client/${encodeURIComponent(task.share_token)}`, requestOrigin);
  const safeTitle = escapeHtml(task.title || task.task_title);
  const safeDescription = escapeHtml(task.description || 'No description provided.');
  const text = `${task.title || task.task_title}\n\n${task.description || 'No description provided.'}\n\nView task: ${url}`;
  const html = emailLayout('New task assigned', `
    <p><strong>${safeTitle}</strong></p>
    <p style="white-space:pre-wrap">${safeDescription}</p>
    <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#b94b22;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none">View task</a></p>
  `);
  return sendEmail({ to: recipientEmail, subject: `Task assigned: ${task.title || task.task_title}`, text, html });
}

import { notFound } from 'next/navigation';
import { getSql } from '../../../lib/db';
import { WA_NUMBER, FACEBOOK, INSTAGRAM, COMPANY_NAME, COMPANY_WEBSITE, COMPANY_EMAIL, PAYMENT_ACCOUNTS, PAYMENT_ACCOUNT_NAME } from '../../../lib/config';
import { calculateInvoiceTotals } from '../../../lib/invoiceMath';
import DownloadPdfButton from './DownloadPdfButton';
import PrintButton from './PrintButton';
import BrandLogo from '../../components/BrandLogo';

function fmt(value) {
  if (!value) return '';
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function money(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CURRENCY_SYMBOLS = { PKR: 'Rs ', USD: '$', GBP: '£', EUR: '€', AED: 'AED ', SAR: 'SAR ' };
const PAYMENT_STATUS_LABELS = { unpaid: 'Unpaid', partially_paid: 'Partially paid', paid: 'Paid' };

function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code] || `${code || ''} `;
}

export default async function InvoicePage({ params }) {
  const { token } = await params;
  const sql = getSql();
  const rows = await sql`
    SELECT invoice.id::text, invoice.invoice_number, invoice.client_name,
      invoice.client_company, invoice.client_address, invoice.client_email,
      invoice.issue_date AS invoice_date, invoice.due_date, invoice.project_name,
      invoice.subtotal, invoice.discount, invoice.tax_rate, invoice.total,
      invoice.amount_paid, invoice.payment_status, invoice.currency, invoice.notes,
      COALESCE(
        json_agg(
          json_build_object(
            'id', item.id,
            'description', item.description,
            'quantity', item.quantity,
            'unit_price', item.unit_price,
            'sort_order', item.sort_order
          ) ORDER BY item.sort_order, item.id
        ) FILTER (WHERE item.id IS NOT NULL),
        '[]'::json
      ) AS items
    FROM invoices invoice
    LEFT JOIN invoice_items item ON item.invoice_id = invoice.id
    WHERE invoice.share_token = ${String(token || '')}
      AND invoice.archived_at IS NULL
    GROUP BY invoice.id
    LIMIT 1
  `;
  const invoice = rows[0];
  if (!invoice) notFound();

  const items = invoice.items || [];
  const totals = calculateInvoiceTotals(invoice);
  const balance = Math.max(0, totals.total - Number(invoice.amount_paid || 0));
  const symbol = currencySymbol(invoice.currency);

  return (
    <main className="invoice-page" style={{ background: 'var(--bg)', minHeight: '100vh', padding: '2rem 1rem' }}>
      <div className="invoice-sheet" style={{ maxWidth: 700, margin: '0 auto' }}>
        <div style={{ textAlign: 'right', marginBottom: '1rem', display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }} className="no-print">
          <DownloadPdfButton filename={`${invoice.invoice_number || 'invoice'}.pdf`} />
          <PrintButton />
        </div>

        <article id="invoice-printable" className="invoice-card" style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 24px rgba(0,0,0,0.08)', padding: '2.5rem', color: '#1a1a1a' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              {/* The invoice is always a light document, so pin the light logo
                  asset regardless of the viewer's theme — otherwise dark mode
                  swaps in logo-dark.png and it vanishes on white. */}
              <BrandLogo alt={COMPANY_NAME} variant="light" priority style={{ height: 56, width: 'auto', maxWidth: 220, marginBottom: 8 }} />
              <p style={{ margin: '4px 0', fontSize: 13, color: '#555' }}>{COMPANY_NAME}</p>
              <p style={{ margin: '4px 0', fontSize: 13, color: '#555' }}>{COMPANY_WEBSITE}</p>
              <p style={{ margin: '4px 0', fontSize: 13, color: '#555' }}>{COMPANY_EMAIL}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#B43D17', letterSpacing: '-0.5px' }}>INVOICE</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{invoice.invoice_number}</div>
              <div style={{ marginTop: 12 }}>
                <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--ink)' }}>
                  {PAYMENT_STATUS_LABELS[invoice.payment_status] || 'Unpaid'}
                </span>
              </div>
            </div>
          </header>

          <div className="invoice-bill-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#666', marginBottom: 6 }}>Bill to</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{invoice.client_name}</div>
              {invoice.client_company && <div style={{ fontSize: 13, color: '#555' }}>{invoice.client_company}</div>}
              {invoice.client_address && <div style={{ fontSize: 13, color: '#555', whiteSpace: 'pre-wrap' }}>{invoice.client_address}</div>}
              {invoice.client_email && <div style={{ fontSize: 13, color: '#555' }}>{invoice.client_email}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              {[
                ['Invoice date', fmt(invoice.invoice_date)],
                ['Due date', fmt(invoice.due_date)],
                invoice.project_name ? ['Project', invoice.project_name] : null,
              ].filter(Boolean).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: '#666' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 120, textAlign: 'right' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '2px solid #B43D17', marginBottom: '1.5rem' }} />

          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: '1.5rem' }}>
            <table className="invoice-table" style={{ width: '100%', minWidth: 420, borderCollapse: 'collapse' }}>
              <caption className="sr-only">Invoice line items</caption>
              <thead>
                <tr style={{ background: '#f8f4f0' }}>
                  {['Description', 'Qty', 'Unit price', 'Amount'].map(heading => (
                    <th key={heading} scope="col" style={{ padding: '10px 12px', textAlign: heading === 'Description' ? 'left' : 'right', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#555' }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const amount = Number(item.quantity || 1) * Number(item.unit_price || 0);
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f0ede9' }}>
                      <td style={{ padding: 12, fontSize: 14 }}>{item.description}</td>
                      <td style={{ padding: 12, textAlign: 'right', fontSize: 14 }}>{item.quantity}</td>
                      <td style={{ padding: 12, textAlign: 'right', fontSize: 14 }}>{symbol}{money(item.unit_price)}</td>
                      <td style={{ padding: 12, textAlign: 'right', fontSize: 14, fontWeight: 600 }}>{symbol}{money(amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
            <div style={{ minWidth: 260 }}>
              {[
                ['Subtotal', `${symbol}${money(totals.subtotal)}`],
                [`Tax (${invoice.tax_rate || 0}%)`, `${symbol}${money(totals.taxAmount)}`],
                ['Discount', `-${symbol}${money(totals.discount)}`],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: '#555', borderBottom: '1px solid #f0ede9' }}>
                  <span>{label}</span><span>{value}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 0', fontSize: 18, fontWeight: 800, color: '#B43D17' }}>
                <span>Total</span><span>{symbol}{money(totals.total)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 0', fontSize: 13, color: '#2e6b34' }}>
                <span>Amount paid</span><span>{symbol}{money(invoice.amount_paid)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 0', fontSize: 14, fontWeight: 700, color: '#7a5300' }}>
                <span>Balance remaining</span><span>{symbol}{money(balance)}</span>
              </div>
            </div>
          </div>

          {balance > 0 && (
            <div style={{ background: '#f8f4f0', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#555', marginBottom: 8 }}>Payment details</div>
              <p style={{ margin: '3px 0', fontSize: 13 }}>{PAYMENT_ACCOUNTS.map(account => `${account.provider}: ${account.number}`).join(' · ')}</p>
              <p style={{ margin: '3px 0', fontSize: 13 }}>Account name: {PAYMENT_ACCOUNT_NAME}</p>
            </div>
          )}

          {invoice.notes && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#555', marginBottom: 6 }}>Notes</div>
              <p style={{ fontSize: 13, color: '#555', margin: 0, whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>
            </div>
          )}

          <div style={{ textAlign: 'center', borderTop: '1px solid #f0ede9', paddingTop: '1.5rem' }}>
            <p style={{ fontSize: 13, color: '#666', margin: '0 0 12px' }}>Thank you for choosing {COMPANY_NAME}!</p>
            <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
              <a href={FACEBOOK} target="_blank" rel="noopener noreferrer" style={{ color: '#B43D17', fontSize: 12 }}>Facebook</a>
              <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" style={{ color: '#B43D17', fontSize: 12 }}>Instagram</a>
              <a href={`https://wa.me/${WA_NUMBER}`} target="_blank" rel="noopener noreferrer" style={{ color: '#B43D17', fontSize: 12 }}>WhatsApp</a>
            </div>
          </div>
        </article>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          /* A4 with a small margin, and force the browser's own print
             headers/footers (date, URL) off so they can't add a page. */
          @page { size: A4 portrait; margin: 8mm; }
          .invoice-page { background: white !important; padding: 0 !important; min-height: 0 !important; }
          .invoice-sheet { max-width: none !important; margin: 0 !important; }
          .invoice-card {
            box-shadow: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
            max-width: none !important;
            /* Shrink slightly so the whole document fits one sheet rather
               than spilling a couple of lines onto page two. */
            zoom: 0.86;
          }
          /* Never split a row, block or heading across pages. */
          .invoice-card, .invoice-table, .invoice-table tr,
          .invoice-card table, .invoice-card div, .invoice-card p {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .invoice-table { min-width: 0 !important; }
          .invoice-table thead { display: table-header-group; }
          .invoice-table tfoot { display: table-footer-group; }
          /* The horizontal scroll wrapper would clip content when printed. */
          .invoice-table, .invoice-table > * { width: 100% !important; }
          .no-print * { display: none !important; }
        }
        @media (max-width: 640px) {
          .invoice-page { padding: 1rem 0.5rem !important; }
          .invoice-card { padding: 1.25rem !important; border-radius: 12px !important; }
          .invoice-bill-grid { grid-template-columns: 1fr !important; text-align: left !important; }
          .invoice-bill-grid > div:last-child { text-align: left !important; }
          .invoice-bill-grid > div:last-child > div { justify-content: space-between !important; }
        }
      `}</style>
    </main>
  );
}

import { getSql } from '../../lib/db';
import { WA_NUMBER, FACEBOOK, INSTAGRAM } from '../../lib/config';
import { addDays, businessDate, businessMonth, isoDate } from '../../lib/dates';

export const dynamic = 'force-dynamic';

function monthLabel(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function fmtLong(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export default async function AvailabilityPage({ searchParams }) {
  const query = await searchParams;
  const rawOffset = Array.isArray(query?.m) ? query.m[0] : query?.m;
  const parsedOffset = Number.parseInt(rawOffset || '0', 10);
  const offset = Number.isFinite(parsedOffset) ? Math.max(-24, Math.min(24, parsedOffset)) : 0;
  const today = businessDate();
  const currentMonth = businessMonth();
  const viewDate = new Date(Date.UTC(currentMonth.year, currentMonth.month - 1 + offset, 1));
  const year = viewDate.getUTCFullYear();
  const month = viewDate.getUTCMonth() + 1;
  const firstDay = viewDate.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const sql = getSql();
  const rows = await sql`
    SELECT start_date::text, due_date::text
    FROM tasks
    WHERE status <> 'done'
      AND archived_at IS NULL
      AND start_date IS NOT NULL
      AND due_date IS NOT NULL
  `;
  const ranges = rows.map(row => ({
    start: String(row.start_date).slice(0, 10),
    end: String(row.due_date).slice(0, 10),
  }));
  const isBusy = value => ranges.some(range => range.start <= value && value <= range.end);
  let nextAvailable = null;
  for (let index = 0; index < 180; index += 1) {
    const candidate = addDays(today, index);
    if (!isBusy(candidate)) {
      nextAvailable = candidate;
      break;
    }
  }
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  const message = encodeURIComponent('Hi, I would like to discuss a new project with CoreFusion Technologies.');

  return (
    <main className="container" style={{ maxWidth: 560 }}>
      <div className="client-hero">
        <img src="/logo.png" alt="CoreFusion Technologies" className="client-logo" />
        <h1 style={{ margin: 0 }}>Current availability</h1>
      </div>

      <div className="card">
        {nextAvailable ? (
          <p style={{ margin: '0 0 1.5rem', textAlign: 'center' }}>
            Next open slot: <strong>{fmtLong(nextAvailable)}</strong>
          </p>
        ) : (
          <p className="muted" style={{ margin: '0 0 1.5rem', textAlign: 'center' }}>
            Fully booked for the next six months. Reach out and we will find the soonest fit.
          </p>
        )}

        <nav className="nav-row" aria-label="Calendar month">
          <a href={`/availability?m=${offset - 1}`} className="secondary" aria-label="Previous month">Previous</a>
          <strong style={{ fontSize: 15 }} aria-live="polite">{monthLabel(year, month)}</strong>
          <a href={`/availability?m=${offset + 1}`} className="secondary" aria-label="Next month">Next</a>
        </nav>

        <div className="calendar" style={{ marginTop: '0.75rem', gap: 3 }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
            <div key={day} className="cal-header-cell" aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index]}>{day}</div>
          ))}
          {cells.map((day, index) => {
            if (!day) return <div key={`empty-${index}`} className="cal-cell empty" aria-hidden="true" />;
            const value = isoDate(year, month, day);
            const busy = isBusy(value);
            const isToday = value === today;
            return (
              <div key={value} className={`cal-cell ${isToday ? 'is-today' : ''}`} style={{ minHeight: 64 }} aria-current={isToday ? 'date' : undefined}>
                <div className="daynum">{day}</div>
                <div className={`avail-pill ${busy ? 'avail-busy' : 'avail-free'}`}>{busy ? 'Busy' : 'Open'}</div>
              </div>
            );
          })}
        </div>

        <p className="muted" style={{ fontSize: 12, marginTop: '1.5rem', textAlign: 'center' }}>
          Availability reflects committed project dates and does not reveal client details.
        </p>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <a href={`https://wa.me/${WA_NUMBER}?text=${message}`} target="_blank" rel="noopener noreferrer" className="wa-btn">
            Book a slot on WhatsApp
          </a>
        </div>
      </div>

      <div className="client-footer" style={{ flexDirection: 'column', gap: 12 }}>
        <img src="/logo.png" alt="CoreFusion Technologies" className="footer-logo" />
        <p className="muted" style={{ fontSize: 12, margin: 0, textAlign: 'center' }}>
          This page updates automatically as the schedule changes.
        </p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <a href={FACEBOOK} target="_blank" rel="noopener noreferrer" className="social-link">Facebook</a>
          <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className="social-link">Instagram</a>
        </div>
      </div>
    </main>
  );
}

import { headers } from 'next/headers';
import { getSql } from '../../../lib/db';
import { WA_NUMBER, FACEBOOK, INSTAGRAM } from '../../../lib/config';
import { checkPublicRateLimit } from '../../../lib/publicRateLimit';
import BrandLogo from '../../components/BrandLogo';

const STATUS_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Done',
};

const STATUS_PROGRESS = {
  not_started: 5,
  in_progress: 50,
  review: 80,
  done: 100,
};

const STAGES = ['not_started', 'in_progress', 'review', 'done'];

function fmt(dateVal) {
  if (!dateVal) return '';
  const iso = dateVal instanceof Date ? dateVal.toISOString().slice(0, 10) : String(dateVal).slice(0, 10);
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export default async function ClientPage({ params }) {
  const limit = checkPublicRateLimit({ headers: await headers() });
  if (limit.limited) {
    return (
      <main className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <h1>Too many requests</h1>
        <p className="muted">Please wait a minute and try again.</p>
      </main>
    );
  }
  const { token } = await params;
  const sql = getSql();
  const rows = await sql`
    SELECT task.title, task.description, task.notes, task.status,
      task.start_date, task.due_date, task.client_name,
      (
        SELECT array_agg(tm.name ORDER BY ta.is_primary DESC, tm.name)
        FROM task_assignees ta
        JOIN team_members tm ON tm.id = ta.member_id AND tm.archived_at IS NULL
        WHERE ta.task_id = task.id
      ) AS assignee_names
    FROM tasks task
    WHERE task.share_token = ${String(token || '')}
      AND task.client_visible = TRUE
      AND task.archived_at IS NULL
    LIMIT 1
  `;
  const task = rows[0];
  if (!task) {
    return (
      <main className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <h1>Link not found</h1>
        <p className="muted">This link is invalid, unavailable, or no longer active.</p>
      </main>
    );
  }

  const progress = STATUS_PROGRESS[task.status] || 5;
  const assigneeNames = (task.assignee_names || []).filter(Boolean);
  const currentIndex = STAGES.indexOf(task.status);
  const message = encodeURIComponent(`Hi, I'm checking on my project: ${task.title}`);

  return (
    <main className="container" style={{ maxWidth: 560 }}>
      <div className="client-hero">
        <BrandLogo className="client-logo" />
        <p className="muted" style={{ marginBottom: 4 }}>{task.client_name}</p>
        <h1 style={{ margin: 0 }}>{task.title}</h1>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="badge" style={{ background: 'var(--accent-soft)', color: `var(--${task.status})` }}>
            <span className="dot" style={{ background: `var(--${task.status})` }} aria-hidden="true" />
            {STATUS_LABELS[task.status]}
          </span>
          {assigneeNames.length > 0 && <span className="muted" style={{ fontSize: 13 }}>Handled by {assigneeNames.join(', ')}</span>}
        </div>

        <div className="progress-track" role="progressbar" aria-label="Project progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <ol className="stage-row" aria-label="Project stages">
          {STAGES.map((stage, index) => (
            <li key={stage} className={`stage-item ${index <= currentIndex ? 'stage-dot-active' : ''}`}>
              <span className={`stage-dot ${index <= currentIndex ? 'stage-dot-active' : ''}`} aria-hidden="true" />
              <span className={`stage-label ${index === currentIndex ? 'stage-label-active' : ''}`}>{STATUS_LABELS[stage]}</span>
            </li>
          ))}
        </ol>

        <div className="form-grid" style={{ marginTop: 8 }}>
          <div>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Starting</p>
            <p style={{ margin: '2px 0 0', fontWeight: 500 }}>{fmt(task.start_date)}</p>
          </div>
          <div>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Expected completion</p>
            <p style={{ margin: '2px 0 0', fontWeight: 500 }}>{fmt(task.due_date)}</p>
          </div>
        </div>

        {task.description && (
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 16 }}>
            <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Project details</p>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{task.description}</p>
          </div>
        )}

        {task.notes && (
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 16 }}>
            <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Notes from our team</p>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{task.notes}</p>
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <a href={`https://wa.me/${WA_NUMBER}?text=${message}`} target="_blank" rel="noopener noreferrer" className="wa-btn">
            Chat with us on WhatsApp
          </a>
        </div>
      </div>

      <div className="client-footer" style={{ flexDirection: 'column', gap: 12 }}>
        <BrandLogo className="footer-logo" />
        <p className="muted" style={{ fontSize: 12, margin: 0, textAlign: 'center' }}>
          This page updates automatically as your project progresses.
        </p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <a href="/availability" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>View availability</a>
          <a href={FACEBOOK} target="_blank" rel="noopener noreferrer" className="social-link">Facebook</a>
          <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className="social-link">Instagram</a>
        </div>
      </div>
    </main>
  );
}

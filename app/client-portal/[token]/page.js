import { getSql } from '../../../lib/db';
import { WA_NUMBER, FACEBOOK, INSTAGRAM } from '../../../lib/config';
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

function fmt(dateVal) {
  if (!dateVal) return '';
  const iso = dateVal instanceof Date ? dateVal.toISOString().slice(0, 10) : String(dateVal).slice(0, 10);
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function TaskRow({ task }) {
  const progress = STATUS_PROGRESS[task.status] || 5;
  return (
    <article style={{ padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>{task.title}</strong>
        <span className="badge" style={{ background: 'var(--accent-soft)', color: `var(--${task.status})` }}>
          <span className="dot" style={{ background: `var(--${task.status})` }} aria-hidden="true" />
          {STATUS_LABELS[task.status]}
        </span>
      </div>
      <div className="progress-track" role="progressbar" aria-label={`${task.title} progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress} style={{ marginTop: 8 }}>
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
        {fmt(task.start_date)} to {fmt(task.due_date)}
        {(task.assignee_names || []).filter(Boolean).length > 0
          ? ` · Handled by ${(task.assignee_names || []).filter(Boolean).join(', ')}`
          : ''}
      </p>
      {task.notes && <p style={{ fontSize: 13, margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{task.notes}</p>}
    </article>
  );
}

export default async function ClientPortalPage({ params }) {
  const { token } = await params;
  const sql = getSql();
  const portalRows = await sql`
    SELECT name
    FROM client_portals
    WHERE token = ${String(token || '')} AND archived_at IS NULL
    LIMIT 1
  `;
  const portal = portalRows[0];
  if (!portal) {
    return (
      <main className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <h1>Link not found</h1>
        <p className="muted">This link is invalid or no longer active.</p>
      </main>
    );
  }

  const tasks = await sql`
    SELECT task.id::text, task.title, task.status, task.start_date, task.due_date, task.notes,
      (
        SELECT array_agg(tm.name ORDER BY ta.is_primary DESC, tm.name)
        FROM task_assignees ta
        JOIN team_members tm ON tm.id = ta.member_id AND tm.archived_at IS NULL
        WHERE ta.task_id = task.id
      ) AS assignee_names
    FROM tasks task
    WHERE task.client_name = ${portal.name}
      AND task.archived_at IS NULL
      AND task.client_visible = TRUE
    ORDER BY (task.status = 'done') ASC, task.due_date ASC NULLS LAST, task.id ASC
  `;

  const active = tasks.filter(task => task.status !== 'done');
  const done = tasks.filter(task => task.status === 'done');
  const message = encodeURIComponent("Hi, I'm checking on my project(s) with you.");

  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <div className="client-hero">
        <BrandLogo className="client-logo" />
        <p className="muted" style={{ marginBottom: 4 }}>Project overview for</p>
        <h1 style={{ margin: 0 }}>{portal.name}</h1>
      </div>

      {tasks.length === 0 && (
        <div className="card">
          <p className="muted">No active projects to show right now.</p>
        </div>
      )}

      {active.length > 0 && (
        <section className="card" aria-labelledby="active-projects">
          <strong id="active-projects" style={{ fontSize: 15 }}>Active ({active.length})</strong>
          {active.map(task => <TaskRow key={task.id} task={task} />)}
        </section>
      )}

      {done.length > 0 && (
        <section className="card" style={{ marginTop: 16 }} aria-labelledby="completed-projects">
          <strong id="completed-projects" style={{ fontSize: 15 }}>Completed ({done.length})</strong>
          {done.map(task => <TaskRow key={task.id} task={task} />)}
        </section>
      )}

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <a href={`https://wa.me/${WA_NUMBER}?text=${message}`} target="_blank" rel="noopener noreferrer" className="wa-btn">
          Chat with us on WhatsApp
        </a>
      </div>

      <div className="client-footer" style={{ flexDirection: 'column', gap: 12 }}>
        <BrandLogo className="footer-logo" />
        <p className="muted" style={{ fontSize: 12, margin: 0, textAlign: 'center' }}>
          This page updates automatically as your projects progress.
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

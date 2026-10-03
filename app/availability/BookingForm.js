'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { HONEYPOT_FIELD, SERVICE_SUGGESTIONS } from '../../lib/bookingRequests';

async function readApiResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.status = response.status;
    error.fields = data.fields || {};
    throw error;
  }
  return data;
}

const EMPTY = { name: '', email: '', phone: '', company: '', service: '', message: '' };

/**
 * Booking request form shown on the public availability page once a date is
 * chosen. Posts to /api/booking-requests.
 */
export default function BookingForm({ date, dateLabel, busy, clearHref }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  function clear() {
    router.push(clearHref);
  }

  function update(key) {
    return event => setForm(previous => ({ ...previous, [key]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError('');
    setFields({});
    setSaving(true);
    try {
      await readApiResponse(await fetch('/api/booking-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          requested_date: date,
          [HONEYPOT_FIELD]: form[HONEYPOT_FIELD] || '',
        }),
      }));
      setDone(true);
    } catch (caught) {
      setError(caught.message);
      setFields(caught.fields || {});
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="card" style={{ marginTop: '1.5rem', borderColor: 'var(--green-fg)' }} id="booking-done">
        <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Request received</h2>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Thanks - we have your request for <strong>{dateLabel}</strong>. We will reply by email or phone
          to confirm whether the slot is still free.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="secondary" onClick={clear}>Request another date</button>
        </div>
      </div>
    );
  }

  return (
    <form className="card" style={{ marginTop: '1.5rem' }} onSubmit={submit} id="booking-form">
      <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Request {dateLabel}</h2>
      <p className="muted" style={{ margin: '0 0 16px', fontSize: 13 }}>
        {busy
          ? 'This date overlaps committed work. Send the request anyway and we will find the nearest open slot.'
          : 'Send a request and we will confirm the slot by email or phone.'}
      </p>

      {error ? <div className="error-alert" role="alert" style={{ marginBottom: 14 }}>{error}</div> : null}

      <div className="form-grid">
        <label className="field" style={{ marginBottom: 12 }}>
          <span>Your name</span>
          <input
            required
            maxLength={150}
            autoComplete="name"
            value={form.name}
            onChange={update('name')}
            aria-describedby={fields.name ? 'booking-name-error' : undefined}
          />
          {fields.name ? <small id="booking-name-error" style={{ color: 'var(--red-fg)' }}>{fields.name}</small> : null}
        </label>

        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <label className="field" style={{ marginBottom: 12 }}>
            <span>Email</span>
            <input
              type="email"
              maxLength={254}
              autoComplete="email"
              value={form.email}
              onChange={update('email')}
              aria-describedby={fields.email ? 'booking-email-error' : undefined}
            />
            {fields.email ? <small id="booking-email-error" style={{ color: 'var(--red-fg)' }}>{fields.email}</small> : null}
          </label>

          <label className="field" style={{ marginBottom: 12 }}>
            <span>Phone</span>
            <input
              type="tel"
              maxLength={25}
              autoComplete="tel"
              value={form.phone}
              onChange={update('phone')}
              placeholder="Optional if you gave an email"
            />
          </label>
        </div>

        <label className="field" style={{ marginBottom: 12 }}>
          <span>What do you need?</span>
          <input
            list="booking-services"
            maxLength={100}
            value={form.service}
            onChange={update('service')}
            placeholder="Optional"
          />
          <datalist id="booking-services">
            {SERVICE_SUGGESTIONS.map(option => <option key={option} value={option} />)}
          </datalist>
        </label>

        <label className="field" style={{ marginBottom: 12 }}>
          <span>Project details</span>
          <textarea
            rows={4}
            maxLength={2000}
            value={form.message}
            onChange={update('message')}
            placeholder="Optional - a short description helps us reply usefully"
          />
        </label>
      </div>

      {/* Honeypot: hidden from people, filled in by bots. Never validated or sent. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Leave this field empty
          <input name={HONEYPOT_FIELD} value={form[HONEYPOT_FIELD] || ''} onChange={update(HONEYPOT_FIELD)} tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <button type="submit" disabled={saving}>
          {saving ? 'Sending...' : 'Request this date'}
        </button>
        <button type="button" className="secondary" onClick={clear} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}
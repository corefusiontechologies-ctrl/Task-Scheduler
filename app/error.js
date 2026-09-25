'use client';
import { useEffect } from 'react';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    // Best-effort console log so the error is still visible in server/edge logs.
    console.error(error);
  }, [error]);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 14, padding: '2rem', textAlign: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ fontSize: 40 }}>⚠️</div>
      <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
      <p style={{ color: '#8a8580', maxWidth: 420, margin: 0, fontSize: 14 }}>
        This page hit an unexpected error. It&apos;s been logged — try again, or head back to the dashboard.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={() => reset()}
          style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #D8602A', background: '#D8602A', color: '#fff', cursor: 'pointer', fontSize: 14 }}
        >
          Try again
        </button>
        <a
          href="/dashboard"
          style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #d8d4cf', color: 'inherit', textDecoration: 'none', fontSize: 14 }}
        >
          Back to dashboard
        </a>
      </div>
    </div>
  );
}

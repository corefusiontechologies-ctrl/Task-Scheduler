export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 14, padding: '2rem', textAlign: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ fontSize: 40 }}>🔎</div>
      <h1 style={{ fontSize: 20, margin: 0 }}>Page not found</h1>
      <p style={{ color: '#8a8580', maxWidth: 420, margin: 0, fontSize: 14 }}>
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <a
        href="/dashboard"
        style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #D8602A', background: '#D8602A', color: '#fff', textDecoration: 'none', fontSize: 14, marginTop: 6 }}
      >
        Back to dashboard
      </a>
    </div>
  );
}

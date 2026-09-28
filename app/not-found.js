import Link from 'next/link';
import BrandLogo from './components/BrandLogo';

export default function NotFound() {
  return (
    <main className="login-body">
      <div className="login-card" style={{ width: 380, maxWidth: '100%' }}>
        <BrandLogo className="login-logo" style={{ height: 56 }} width={200} height={56} />
        <p
          aria-hidden="true"
          style={{
            fontSize: 52,
            lineHeight: 1,
            fontWeight: 700,
            letterSpacing: '-0.04em',
            margin: '8px 0 0',
            color: 'var(--accent)',
            opacity: 0.22,
          }}
        >
          404
        </p>
        <h1 style={{ margin: '0 0 6px', fontSize: 20 }}>Link not available</h1>
        <p className="muted" style={{ fontSize: 14, margin: 0 }}>
          This link is invalid, has expired, or the item is no longer shared.
        </p>
        <Link href="/" className="btn-link" style={{ marginTop: 22, width: '100%' }}>
          Go to homepage
        </Link>
      </div>
    </main>
  );
}

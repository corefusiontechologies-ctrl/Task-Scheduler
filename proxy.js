import { NextResponse } from 'next/server';
import { decodeSession, parseCookieHeader } from './lib/session';
import { checkPublicRateLimit } from './lib/publicRateLimit';

// Public, unauthenticated pages worth throttling. `/` and `/login` are
// deliberately excluded: the login form has its own persistent limiter, and
// throttling the landing page would only block real users from reading it.
// The share-token pages are throttled too - they are the widest public
// surface, since anyone holding a link can load them.
const RATE_LIMITED_PATHS = new Set(['/availability']);

// `/api/booking-requests` is public only so an unauthenticated visitor can
// POST a date request from the availability page. The GET and PATCH handlers
// still call getFreshSession() and require manage_availability, so lifting the
// cookie gate here exposes nothing to anonymous callers. The write itself is
// bounded by a honeypot and two rate limits inside the route.
const PUBLIC_PATHS = new Set(['/', '/login', '/api/login', '/api/logout', '/availability', '/api/booking-requests', '/favicon.ico', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml']);
const PUBLIC_TOKEN_ROUTES = [/^\/client\/[^/]+\/?$/, /^\/invoice\/[^/]+\/?$/, /^\/client-portal\/[^/]+\/?$/];

function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_TOKEN_ROUTES.some(pattern => pattern.test(pathname));
}

function tooManyRequests(result) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Too many requests</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #F5F3F0; color: #2A2724;
         font: 15px/1.6 system-ui, -apple-system, sans-serif; }
  main { max-width: 420px; padding: 32px; text-align: center; }
  h1 { font-size: 20px; margin: 0 0 10px; }
  p { margin: 0 0 8px; color: #6B655E; }
  strong { color: #C03030; }
</style>
</head>
<body>
<main>
  <h1>Too many requests</h1>
  <p>You have sent more than <strong>${result.maxRequests} requests</strong> in one minute.</p>
  <p>Please wait ${result.retryAfterSeconds} second${result.retryAfterSeconds === 1 ? '' : 's'} and try again.</p>
</main>
</body>
</html>`;
  return new NextResponse(html, {
    status: 429,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': String(result.retryAfterSeconds),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-RateLimit-Limit': String(result.maxRequests),
      'X-RateLimit-Remaining': '0',
    },
  });
}

function unauthorized(request) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request) {
  const pathname = request.nextUrl.pathname;
  if (isPublicPath(pathname)) {
    const rateLimited = RATE_LIMITED_PATHS.has(pathname)
      || PUBLIC_TOKEN_ROUTES.some(pattern => pattern.test(pathname));
    if (rateLimited) {
      const result = checkPublicRateLimit(request);
      if (result.limited) return tooManyRequests(result);
    }
    return NextResponse.next();
  }
  const session = await decodeSession(parseCookieHeader(request.headers.get('cookie')).session);
  if (!session) return unauthorized(request);
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin');
  if (isAdminPath && session.role !== 'superadmin') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Superadmin access required' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/dashboard?error=forbidden', request.url));
  }
  return NextResponse.next();
}

// `api/cron` and `api/test-email` bypass the session gate: they are not
// user-facing routes, and are guarded by CRON_SECRET (plus a production
// block on test-email) instead. Everything else requires a signed session.
export const config = {
  matcher: ['/((?!api/cron|api/test-email|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};

import { NextResponse } from 'next/server';
import { decodeSession, parseCookieHeader } from './lib/session';

const PUBLIC_PATHS = new Set(['/', '/login', '/api/login', '/api/logout', '/availability', '/favicon.ico', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml']);
const PUBLIC_TOKEN_ROUTES = [/^\/client\/[^/]+\/?$/, /^\/invoice\/[^/]+\/?$/, /^\/client-portal\/[^/]+\/?$/];

function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_TOKEN_ROUTES.some(pattern => pattern.test(pathname));
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
  if (isPublicPath(pathname)) return NextResponse.next();
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

export const config = {
  matcher: ['/((?!api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};

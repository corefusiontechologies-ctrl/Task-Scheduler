import { getSql } from './db';

const DEFAULT_WINDOW_MINUTES = 15;
const DEFAULT_MAX_ATTEMPTS = 8;
let cleanupCounter = 0;

export function getClientIp(request) {
  const forwarded = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 128);
  return (request.headers.get('x-real-ip') || 'unknown').slice(0, 128);
}

export async function getRateLimitState(request, maxAttempts = DEFAULT_MAX_ATTEMPTS, windowMs = DEFAULT_WINDOW_MINUTES * 60 * 1000) {
  const ip = getClientIp(request);
  const rows = await getSql()`
    SELECT COUNT(*)::int AS attempts, MIN(created_at) AS oldest
    FROM login_attempts
    WHERE ip = ${ip}
      AND success = false
      AND created_at > NOW() - (${windowMs}::text || ' milliseconds')::interval
  `;
  const attempts = Number(rows[0]?.attempts || 0);
  const blocked = attempts >= maxAttempts;
  const oldest = rows[0]?.oldest ? new Date(rows[0].oldest).getTime() : Date.now();
  return {
    ip,
    maxAttempts,
    windowMs,
    attempts,
    blocked,
    retryAfterSeconds: blocked ? Math.max(1, Math.ceil((oldest + windowMs - Date.now()) / 1000)) : 0,
  };
}

export async function recordRateLimitAttempt(request, username, success) {
  const ip = getClientIp(request);
  const sql = getSql();
  await sql`
    INSERT INTO login_attempts (username, ip, success)
    VALUES (${String(username || '').slice(0, 150)}, ${ip}, ${!!success})
  `;
  cleanupCounter += 1;
  if (cleanupCounter % 20 === 0) {
    await sql`DELETE FROM login_attempts WHERE created_at < NOW() - INTERVAL '1 day'`;
  }
}

export function serializeRateLimitHeaders(state) {
  const remaining = Math.max(0, state.maxAttempts - state.attempts);
  const headers = {
    'X-RateLimit-Limit': String(state.maxAttempts),
    'X-RateLimit-Remaining': String(remaining),
  };
  if (state.blocked) headers['Retry-After'] = String(state.retryAfterSeconds);
  return headers;
}

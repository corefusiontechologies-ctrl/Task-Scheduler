const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 60;
const MAX_TRACKED_CLIENTS = 10000;
const buckets = new Map();

function clientKey(request) {
  const forwarded = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 128);
  return (request.headers.get('x-real-ip') || 'unknown').slice(0, 128);
}

export function checkPublicRateLimit(request, maxRequests = MAX_REQUESTS, windowMs = WINDOW_MS) {
  const key = clientKey(request);
  const now = Date.now();
  if (buckets.size > MAX_TRACKED_CLIENTS) {
    for (const [entryKey, entry] of buckets) {
      if (now - entry.startedAt > windowMs) buckets.delete(entryKey);
    }
  }
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    bucket = { startedAt: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    limited: bucket.count > maxRequests,
    maxRequests,
    remaining: Math.max(0, maxRequests - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000)),
  };
}

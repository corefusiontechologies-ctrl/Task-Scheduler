const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function encodeJson(value) {
  return encodeBytes(encoder.encode(JSON.stringify(value)));
}

function decodeJson(value) {
  return JSON.parse(decoder.decode(decodeBytes(value)));
}

function constantTimeEqual(left, right) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

function sessionDurationSeconds() {
  const configured = Number(process.env.SESSION_TTL_SECONDS || 28800);
  if (!Number.isFinite(configured)) return 28800;
  return Math.min(604800, Math.max(300, Math.floor(configured)));
}

async function hmac(value, secret) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || encoder.encode(secret).length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes');
  }
  return secret;
}

export async function signSession(user, nowSeconds = Math.floor(Date.now() / 1000)) {
  const secret = getSessionSecret();
  const duration = sessionDurationSeconds();
  const header = encodeJson({ alg: 'HS256', v: 1 });
  // Accept either casing: DB rows expose session_version, while callers
  // working with a live session object carry sessionVersion. Reading only one
  // of them silently stamps sv:0 and logs the user out on the next request.
  const sessionVersion = user.session_version ?? user.sessionVersion ?? 0;
  const payload = encodeJson({
    sub: String(user.id),
    username: user.username,
    role: user.role,
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    iat: nowSeconds,
    exp: nowSeconds + duration,
    sv: Number(sessionVersion || 0),
  });
  const unsigned = `${header}.${payload}`;
  const signature = await hmac(unsigned, secret);
  return `${unsigned}.${encodeBytes(signature)}`;
}

export async function decodeSession(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    const expected = await hmac(`${header}.${payload}`, getSessionSecret());
    if (!constantTimeEqual(decodeBytes(signature), expected)) return null;
    const parsedHeader = decodeJson(header);
    const parsedPayload = decodeJson(payload);
    if (parsedHeader.alg !== 'HS256' || parsedHeader.v !== 1) return null;
    if (!parsedPayload.sub || !parsedPayload.username || !parsedPayload.role) return null;
    if (!Number.isInteger(parsedPayload.exp) || parsedPayload.exp <= nowSeconds) return null;
    if (!Array.isArray(parsedPayload.permissions)) return null;
    return {
      id: parsedPayload.sub,
      username: parsedPayload.username,
      role: parsedPayload.role,
      permissions: parsedPayload.permissions,
      issuedAt: parsedPayload.iat,
      expiresAt: parsedPayload.exp,
      sessionVersion: Number(parsedPayload.sv || 0),
    };
  } catch {
    return null;
  }
}

export function parseCookieHeader(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

export function sessionCookie(token) {
  return {
    name: 'session',
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionDurationSeconds(),
  };
}

export function clearSessionCookie() {
  return { ...sessionCookie(''), maxAge: 0 };
}

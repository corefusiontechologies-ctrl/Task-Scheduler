const PBKDF2_ITERATIONS = 310000;
const PBKDF2_PREFIX = 'pbkdf2_sha256';
const KEY_BYTES = 32;
const SALT_BYTES = 16;

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

async function derivePassword(password, salt, iterations) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left, right) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    throw new Error('Password must be between 12 and 1024 characters');
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const digest = await derivePassword(password, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${encodeBytes(salt)}$${encodeBytes(digest)}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  if (storedHash.startsWith(`${PBKDF2_PREFIX}$`)) {
    const [prefix, iterationText, saltText, digestText] = storedHash.split('$');
    const iterations = Number(iterationText);
    if (prefix !== PBKDF2_PREFIX || !Number.isSafeInteger(iterations) || iterations < 100000 || !saltText || !digestText) {
      return false;
    }
    try {
      const actual = await derivePassword(password, decodeBytes(saltText), iterations);
      return constantTimeEqual(actual, decodeBytes(digestText));
    } catch {
      return false;
    }
  }
  if (!/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  const legacyDigest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return constantTimeEqual(new Uint8Array(legacyDigest), decodeBytes(storedHash.toLowerCase()));
}

export function passwordNeedsUpgrade(storedHash) {
  if (typeof storedHash !== 'string' || !storedHash.startsWith(`${PBKDF2_PREFIX}$`)) return true;
  const iterations = Number(storedHash.split('$')[1]);
  return !Number.isSafeInteger(iterations) || iterations < PBKDF2_ITERATIONS;
}

export function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    throw new Error('Password must be between 12 and 1024 characters');
  }
  return password;
}

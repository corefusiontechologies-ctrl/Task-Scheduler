import { neon } from '@neondatabase/serverless';

let sqlClient;
let rawClient;

export class DatabaseConfigurationError extends Error {
  constructor() {
    super('DATABASE_URL is not configured');
    this.name = 'DatabaseConfigurationError';
  }
}

const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

function isTransient(error) {
  const code = error?.cause?.code || error?.code || '';
  if (RETRYABLE_CODES.has(code)) return true;
  return /ConnectTimeoutError|fetch failed|terminating connection|Connection closed|socket hang up/i.test(
    String(error?.message || ''),
  );
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withRetry(run, attempts = 3) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!isTransient(error) || attempt === attempts) throw error;
      await sleep(200 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150));
    }
  }
  throw last;
}

function getRawSql() {
  if (rawClient) return rawClient;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DatabaseConfigurationError();
  rawClient = neon(connectionString);
  return rawClient;
}

export function getSql() {
  if (sqlClient) return sqlClient;
  const raw = getRawSql();
  sqlClient = (...args) => withRetry(() => raw(...args));
  return sqlClient;
}

export const db = {
  transaction(queriesOrCallback, options) {
    const build = typeof queriesOrCallback === 'function'
      ? queriesOrCallback
      : () => queriesOrCallback;
    return withRetry(() => {
      const queries = build(getRawSql());
      if (!Array.isArray(queries)) {
        throw new Error(
          'db.transaction callback must return an array of queries, not a promise. '
          + 'Return [sql`...`] instead of `sql`...`` directly.',
        );
      }
      return getRawSql().transaction(queries, options);
    });
  },
};

export function genToken(byteLength = 32) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

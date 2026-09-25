import { neon } from '@neondatabase/serverless';

let sqlClient;

export class DatabaseConfigurationError extends Error {
  constructor() {
    super('DATABASE_URL is not configured');
    this.name = 'DatabaseConfigurationError';
  }
}

export function getSql() {
  if (sqlClient) return sqlClient;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DatabaseConfigurationError();
  sqlClient = neon(connectionString);
  return sqlClient;
}

export const db = {
  transaction(queriesOrCallback, options) {
    return getSql().transaction(queriesOrCallback, options);
  },
};

export function genToken(byteLength = 32) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

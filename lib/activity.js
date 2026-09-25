import { sql } from './db';

// Resolves a human-readable "who did this" label for audit trail entries.
// Uses the name cached in the session first (no extra DB query), falls back
// to a DB lookup if not present, and degrades gracefully on any error.
export async function actorLabel(session) {
  if (!session?.userId) return 'Unknown';
  // Fast path: name was stored in the session at login time
  if (session.userName) return session.userName;
  // Slow path: older sessions without the name field
  try {
    const rows = await sql`SELECT name, username FROM users WHERE id = ${session.userId} LIMIT 1`;
    const u = rows[0];
    if (!u) return 'Unknown';
    return u.name || u.username;
  } catch {
    return 'Unknown';
  }
}

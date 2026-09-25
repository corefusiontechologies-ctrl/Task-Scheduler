import { getSql } from './db';

export async function getUserMemberId(userId) {
  if (!userId) return null;
  const rows = await getSql()`
    SELECT id
    FROM team_members
    WHERE user_id = ${userId} AND archived_at IS NULL
    LIMIT 1
  `;
  return rows[0]?.id || null;
}

export async function getTeamMemberById(id) {
  if (!id) return null;
  const rows = await getSql()`
    SELECT *
    FROM team_members
    WHERE id = ${id} AND archived_at IS NULL
    LIMIT 1
  `;
  return rows[0] || null;
}

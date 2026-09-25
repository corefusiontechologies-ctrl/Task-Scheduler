import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { can } from '@/lib/access';
import { getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { optionalId, optionalString, requiredId, requiredString } from '@/lib/validation';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PUT = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'manage_team')) throw new ApiError(403, 'Team management access is required');
  const { id } = await params;
  const memberId = requiredId(id, 'Team member ID');
  const body = await requestJson(request);
  const name = requiredString(body.name, 'Name', { min: 1, max: 150 });
  const role = optionalString(body.role, 'Role', { min: 1, max: 150 }) || '';
  const email = requiredString(body.email, 'Email', { min: 3, max: 254, pattern: EMAIL_PATTERN }).toLowerCase();
  const phone = optionalString(body.phone, 'Phone', { min: 3, max: 50 });
  const userId = optionalId(body.user_id, 'User ID');
  if (userId) {
    const user = await getSql()`SELECT id FROM users WHERE id = ${userId} AND archived_at IS NULL`;
    if (!user[0]) throw new ApiError(400, 'User does not exist');
  }
  const [member] = await getSql()`
    UPDATE team_members
    SET name = ${name}, position = ${role}, email = ${email}, phone = ${phone}, user_id = ${userId}
    WHERE id = ${memberId} AND archived_at IS NULL
    RETURNING id::text, name, position AS role, user_id::text, email, phone, created_at
  `;
  if (!member) throw new ApiError(404, 'Team member not found');
  return NextResponse.json(member);
});

export const DELETE = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (!can(session, 'manage_team')) throw new ApiError(403, 'Team management access is required');
  const { id } = await params;
  const memberId = requiredId(id, 'Team member ID');
  const [member] = await getSql()`
    UPDATE team_members
    SET archived_at = NOW()
    WHERE id = ${memberId} AND archived_at IS NULL
    RETURNING id::text
  `;
  if (!member) throw new ApiError(404, 'Team member not found');
  return NextResponse.json({ ok: true });
});

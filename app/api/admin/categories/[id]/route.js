import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { optionalColor, requiredId, requiredString } from '@/lib/validation';

async function requireSuperadmin() {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
  return session;
}

export const PUT = withApi(async (request, { params }) => {
  await requireSuperadmin();
  const { id } = await params;
  const categoryId = requiredId(id, 'Category ID');
  const body = await requestJson(request);
  const name = requiredString(body.name, 'Name', { min: 1, max: 100 });
  const color = optionalColor(body.color, 'Color') || '#2E7BC4';
  const [category] = await getSql()`
    UPDATE categories
    SET name = ${name}, color = ${color}
    WHERE id = ${categoryId} AND archived_at IS NULL
    RETURNING id::text, name, color
  `;
  if (!category) throw new ApiError(404, 'Category not found');
  return NextResponse.json(category);
});

export const DELETE = withApi(async (request, { params }) => {
  await requireSuperadmin();
  const { id } = await params;
  const categoryId = requiredId(id, 'Category ID');
  const [category] = await getSql()`
    UPDATE categories
    SET archived_at = NOW()
    WHERE id = ${categoryId} AND archived_at IS NULL
    RETURNING id::text
  `;
  if (!category) throw new ApiError(404, 'Category not found');
  return NextResponse.json({ ok: true });
});

import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { optionalColor, requiredString } from '@/lib/validation';

export const GET = withApi(async () => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
  const categories = await getSql()`
    SELECT id::text, name, color
    FROM categories
    WHERE archived_at IS NULL
    ORDER BY name
  `;
  return NextResponse.json(categories);
});

export const POST = withApi(async request => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
  const body = await requestJson(request);
  const name = requiredString(body.name, 'Name', { min: 1, max: 100 });
  const color = optionalColor(body.color, 'Color') || '#2E7BC4';
  const [category] = await getSql()`
    INSERT INTO categories (name, color)
    VALUES (${name}, ${color})
    RETURNING id::text, name, color
  `;
  return NextResponse.json(category, { status: 201 });
});

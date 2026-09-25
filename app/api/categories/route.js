import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { canViewAllTasks } from '@/lib/access';
import { getSql } from '@/lib/db';
import { ApiError, withApi } from '@/lib/http';

export const GET = withApi(async () => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (canViewAllTasks(session)) {
    const categories = await getSql()`
      SELECT id::text, name, color
      FROM categories
      WHERE archived_at IS NULL
      ORDER BY name
    `;
    return NextResponse.json(categories);
  }
  const categories = await getSql()`
    SELECT c.id::text, c.name, c.color
    FROM categories c
    JOIN role_categories rc ON rc.category_id = c.id
    JOIN users u ON u.role_id = rc.role_id
    WHERE u.id = ${session.id} AND c.archived_at IS NULL
    ORDER BY c.name
  `;
  return NextResponse.json(categories);
});

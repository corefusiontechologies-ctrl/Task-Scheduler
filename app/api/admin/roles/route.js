import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { db, getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { addImpliedPermissions, legacyFlags, LEGACY_PERMISSIONS } from '@/lib/permissions';
import { optionalColor, optionalIdList, optionalString, requiredString } from '@/lib/validation';

function requireSuperadmin(session) {
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
}

async function roleInput(body) {
  const name = requiredString(body.name, 'Role name', { min: 1, max: 100 });
  const description = optionalString(body.description, 'Description', { min: 1, max: 500 }) || '';
  const color = optionalColor(body.color, 'Color') || '#6B6760';
  const allowedCategories = optionalIdList(body.allowedCategories, 'Allowed categories');
  let permissions;
  if (Array.isArray(body.permissions)) {
    if (body.permissions.length > 100) throw new ApiError(400, 'Too many permissions');
    permissions = [...new Set(body.permissions.map(value => requiredString(value, 'Permission', { min: 1, max: 100 })))];
  } else {
    permissions = Object.entries(LEGACY_PERMISSIONS)
      .filter(([key]) => body[key] === true)
      .map(([, permission]) => permission);
  }
  permissions = addImpliedPermissions(permissions);
  return { name, description, color, allowedCategories, permissions, flags: legacyFlags(permissions) };
}

export const GET = withApi(async () => {
  const session = await getFreshSession();
  requireSuperadmin(session);
  const roles = await getSql()`
    SELECT r.id::text, r.name, r.description, r.color, r.is_system,
      r.perm_add_tasks, r.perm_edit_tasks, r.perm_delete_tasks,
      r.perm_view_all_tasks, r.perm_view_client_links,
      r.perm_manage_availability, r.perm_manage_invoices,
      COALESCE(ARRAY(
        SELECT p.name
        FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = r.id
        ORDER BY p.name
      ), ARRAY[]::varchar[]) AS permissions,
      COALESCE(ARRAY(
        SELECT rc.category_id::text
        FROM role_categories rc
        WHERE rc.role_id = r.id
        ORDER BY rc.category_id
      ), ARRAY[]::varchar[]) AS allowed_categories
    FROM roles r
    WHERE r.archived_at IS NULL
    ORDER BY r.name
  `;
  return NextResponse.json(roles.map(role => ({ ...role, allowedCategories: role.allowed_categories })));
});

export const POST = withApi(async request => {
  const session = await getFreshSession();
  requireSuperadmin(session);
  const input = await roleInput(await requestJson(request));
  const permissionRows = await getSql()`SELECT name FROM permissions WHERE name = ANY(${input.permissions})`;
  const categoryRows = input.allowedCategories.length
    ? await getSql()`SELECT id FROM categories WHERE id = ANY(${input.allowedCategories}) AND archived_at IS NULL`
    : [];
  if (permissionRows.length !== input.permissions.length) throw new ApiError(400, 'One or more permissions are invalid');
  if (categoryRows.length !== input.allowedCategories.length) throw new ApiError(400, 'One or more categories are invalid');
  // db.transaction returns one result-set per statement, so this destructures
  // to the row array; index [0] is the created role.
  const [createdRows] = await db.transaction(txn => [
    txn`
      WITH created AS (
        INSERT INTO roles (
          name, description, color, perm_add_tasks, perm_edit_tasks, perm_delete_tasks,
          perm_view_all_tasks, perm_view_client_links, perm_manage_availability, perm_manage_invoices
        )
        VALUES (
          ${input.name}, ${input.description}, ${input.color},
          ${input.flags.perm_add_tasks}, ${input.flags.perm_edit_tasks}, ${input.flags.perm_delete_tasks},
          ${input.flags.perm_view_all_tasks}, ${input.flags.perm_view_client_links},
          ${input.flags.perm_manage_availability}, ${input.flags.perm_manage_invoices}
        )
        RETURNING *
      ), permission_rows AS (
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT created.id, permissions.id FROM created CROSS JOIN permissions
        WHERE permissions.name = ANY(${input.permissions})
      ), category_rows AS (
        INSERT INTO role_categories (role_id, category_id)
        SELECT created.id, categories.id FROM created CROSS JOIN categories
        WHERE categories.id = ANY(${input.allowedCategories})
      )
      SELECT * FROM created
    `,
  ]);
  const role = createdRows[0];
  if (!role) throw new ApiError(500, 'The role could not be created');
  return NextResponse.json({
    ...role,
    permissions: input.permissions,
    allowedCategories: input.allowedCategories,
  }, { status: 201 });
});

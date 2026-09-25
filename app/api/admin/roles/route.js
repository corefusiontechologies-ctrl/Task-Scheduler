import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { db, getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { optionalColor, optionalIdList, optionalString, requiredString } from '@/lib/validation';

const LEGACY_PERMISSIONS = {
  perm_add_tasks: 'create_tasks',
  perm_edit_tasks: 'edit_tasks',
  perm_delete_tasks: 'delete_tasks',
  perm_view_all_tasks: 'view_all_tasks',
  perm_view_client_links: 'view_client_links',
  perm_manage_availability: 'manage_availability',
  perm_manage_invoices: 'manage_invoices',
};

function addImpliedPermissions(permissions) {
  const result = new Set(permissions);
  if (['view_all_tasks', 'create_tasks', 'edit_tasks', 'edit_own_tasks', 'delete_tasks'].some(permission => result.has(permission))) result.add('view_tasks');
  if (['create_invoices', 'edit_invoices', 'edit_own_invoices', 'record_payments', 'manage_invoices'].some(permission => result.has(permission))) result.add('view_invoices');
  if (result.has('manage_invoices')) ['create_invoices', 'edit_invoices', 'record_payments'].forEach(permission => result.add(permission));
  if (result.has('manage_team')) result.add('view_team');
  return [...result];
}

function legacyFlags(permissions) {
  return {
    perm_add_tasks: permissions.includes('create_tasks'),
    perm_edit_tasks: permissions.includes('edit_tasks'),
    perm_delete_tasks: permissions.includes('delete_tasks'),
    perm_view_all_tasks: permissions.includes('view_all_tasks'),
    perm_view_client_links: permissions.includes('view_client_links'),
    perm_manage_availability: permissions.includes('manage_availability'),
    perm_manage_invoices: permissions.includes('manage_invoices'),
  };
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
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
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
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
  const input = await roleInput(await requestJson(request));
  const permissionRows = await getSql()`SELECT name FROM permissions WHERE name = ANY(${input.permissions})`;
  const categoryRows = input.allowedCategories.length
    ? await getSql()`SELECT id FROM categories WHERE id = ANY(${input.allowedCategories}) AND archived_at IS NULL`
    : [];
  if (permissionRows.length !== input.permissions.length) throw new ApiError(400, 'One or more permissions are invalid');
  if (categoryRows.length !== input.allowedCategories.length) throw new ApiError(400, 'One or more categories are invalid');
  const [role] = await db.transaction(txn => [
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
  return NextResponse.json({
    ...role,
    permissions: input.permissions,
    allowedCategories: input.allowedCategories,
  }, { status: 201 });
});

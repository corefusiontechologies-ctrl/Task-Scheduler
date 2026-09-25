import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { optionalColor, optionalIdList, optionalString, requiredId, requiredString } from '@/lib/validation';

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

function permissionsFromInput(body) {
  if (Array.isArray(body.permissions)) {
    if (body.permissions.length > 100) throw new ApiError(400, 'Too many permissions');
    return [...new Set(body.permissions.map(value => requiredString(value, 'Permission', { min: 1, max: 100 })))];
  }
  return [...new Set(Object.entries(LEGACY_PERMISSIONS).filter(([key]) => body[key] === true).map(([, value]) => value))];
}

export const PUT = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
  const { id } = await params;
  const roleId = requiredId(id, 'Role ID');
  const body = await requestJson(request);
  const name = requiredString(body.name, 'Role name', { min: 1, max: 100 });
  const description = optionalString(body.description, 'Description', { min: 1, max: 500 }) || '';
  const color = optionalColor(body.color, 'Color') || '#6B6760';
  const allowedCategories = optionalIdList(body.allowedCategories, 'Allowed categories');
  let permissions = permissionsFromInput(body);
  permissions = addImpliedPermissions(permissions);
  const sql = getSql();
  const [permissionRows, categoryRows] = await Promise.all([
    sql`SELECT name FROM permissions WHERE name = ANY(${permissions})`,
    allowedCategories.length
      ? sql`SELECT id FROM categories WHERE id = ANY(${allowedCategories}) AND archived_at IS NULL`
      : Promise.resolve([]),
  ]);
  if (permissionRows.length !== permissions.length) throw new ApiError(400, 'One or more permissions are invalid');
  if (categoryRows.length !== allowedCategories.length) throw new ApiError(400, 'One or more categories are invalid');
  const flags = {
    add: permissions.includes('create_tasks'),
    edit: permissions.includes('edit_tasks'),
    remove: permissions.includes('delete_tasks'),
    viewAll: permissions.includes('view_all_tasks'),
    links: permissions.includes('view_client_links'),
    availability: permissions.includes('manage_availability'),
    invoices: permissions.includes('manage_invoices'),
  };
  const [role] = await sql`
    UPDATE roles
    SET name = ${name}, description = ${description}, color = ${color},
      perm_add_tasks = ${flags.add}, perm_edit_tasks = ${flags.edit},
      perm_delete_tasks = ${flags.remove}, perm_view_all_tasks = ${flags.viewAll},
      perm_view_client_links = ${flags.links}, perm_manage_availability = ${flags.availability},
      perm_manage_invoices = ${flags.invoices}
    WHERE id = ${roleId} AND archived_at IS NULL
    RETURNING *
  `;
  if (!role) throw new ApiError(404, 'Role not found');
  await sql`
    WITH deleted_permissions AS (
      DELETE FROM role_permissions WHERE role_id = ${roleId} RETURNING role_id
    ), deleted_categories AS (
      DELETE FROM role_categories WHERE role_id = ${roleId} RETURNING role_id
    ), permission_rows AS (
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT ${roleId}, permissions.id
      FROM permissions
      WHERE permissions.name = ANY(${permissions})
        AND (
          EXISTS (SELECT 1 FROM deleted_permissions)
          OR NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = ${roleId})
        )
    )
    INSERT INTO role_categories (role_id, category_id)
    SELECT ${roleId}, categories.id
    FROM categories
    WHERE categories.id = ANY(${allowedCategories})
      AND (
        EXISTS (SELECT 1 FROM deleted_categories)
        OR NOT EXISTS (SELECT 1 FROM role_categories WHERE role_id = ${roleId})
      )
  `;
  await sql`
    UPDATE users SET session_version = session_version + 1 WHERE role_id = ${roleId}
  `;
  return NextResponse.json({ ...role, permissions, allowedCategories });
});

export const DELETE = withApi(async (request, { params }) => {
  void request;
  const session = await getFreshSession();
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
  const { id } = await params;
  const roleId = requiredId(id, 'Role ID');
  const [role] = await getSql()`
    UPDATE roles
    SET archived_at = NOW()
    WHERE id = ${roleId} AND archived_at IS NULL AND is_system = FALSE
      AND NOT EXISTS (SELECT 1 FROM users WHERE role_id = ${roleId} AND archived_at IS NULL)
    RETURNING id::text
  `;
  if (!role) {
    const existing = await getSql()`SELECT is_system FROM roles WHERE id = ${roleId} AND archived_at IS NULL`;
    if (!existing[0]) throw new ApiError(404, 'Role not found');
    if (existing[0].is_system) throw new ApiError(409, 'System roles cannot be deleted');
    throw new ApiError(409, 'Role must be empty before it can be deleted');
  }
  return NextResponse.json({ ok: true });
});

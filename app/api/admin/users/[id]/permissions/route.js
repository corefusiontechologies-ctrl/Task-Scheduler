import { NextResponse } from 'next/server';
import { getFreshSession } from '@/lib/auth';
import { db, getSql } from '@/lib/db';
import { ApiError, requestJson, withApi } from '@/lib/http';
import { resolvePermissions } from '@/lib/permissions';
import { optionalIdList, requiredId } from '@/lib/validation';

// Per-user permission and category overrides.
//
// A user's role stays the baseline. These overrides let a superadmin adjust
// one individual without creating a role for them: `allow` adds a permission
// the role does not grant, `deny` removes one it does. Deny wins.
//
// Superadmin bypasses every check in lib/access.js, so an override on a
// superadmin account would be stored but never enforced. That is rejected
// rather than silently accepted, so nobody believes they have restricted an
// account that is actually unrestricted.

function requireSuperadmin(session) {
  if (!session) throw new ApiError(401, 'Authentication required');
  if (session.role !== 'superadmin') throw new ApiError(403, 'Superadmin access required');
}

async function loadTargetUser(userId) {
  const rows = await getSql()`
    SELECT u.id::text, u.username, u.name, u.role, u.role_id::text,
      COALESCE(ARRAY(
        SELECT p.name
        FROM permissions p
        JOIN role_permissions rp ON rp.permission_id = p.id
        WHERE rp.role_id = u.role_id
        ORDER BY p.name
      ), ARRAY[]::varchar[]) AS role_permissions,
      COALESCE(ARRAY(
        SELECT p.name
        FROM user_permission_overrides upo
        JOIN permissions p ON p.id = upo.permission_id
        WHERE upo.user_id = u.id AND upo.effect = 'allow'
        ORDER BY p.name
      ), ARRAY[]::varchar[]) AS allowed_permissions,
      COALESCE(ARRAY(
        SELECT p.name
        FROM user_permission_overrides upo
        JOIN permissions p ON p.id = upo.permission_id
        WHERE upo.user_id = u.id AND upo.effect = 'deny'
        ORDER BY p.name
      ), ARRAY[]::varchar[]) AS denied_permissions,
      COALESCE(ARRAY(
        SELECT uc.category_id::text
        FROM user_categories uc
        WHERE uc.user_id = u.id
        ORDER BY uc.category_id
      ), ARRAY[]::varchar[]) AS user_categories
    FROM users u
    WHERE u.id = ${userId} AND u.archived_at IS NULL
    LIMIT 1
  `;
  const user = rows[0];
  if (!user) throw new ApiError(404, 'User not found');
  return user;
}

function permissionState(user) {
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    isSuperAdmin: user.role === 'superadmin',
    rolePermissions: user.role_permissions || [],
    allowedPermissions: user.allowed_permissions || [],
    deniedPermissions: user.denied_permissions || [],
    // An empty userCategories means "inherit the role's categories".
    userCategories: user.user_categories || [],
    effectivePermissions: resolvePermissions(
      user.role_permissions || [],
      user.allowed_permissions || [],
      user.denied_permissions || [],
    ),
  };
}

/**
 * Full override state for one user, used to populate the admin editor.
 */
export const GET = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  requireSuperadmin(session);
  const { id } = await params;
  const state = permissionState(await loadTargetUser(requiredId(id, 'User ID')));
  return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } });
});

/**
 * Replace a user's overrides wholesale.
 *
 * `allowedPermissions` / `deniedPermissions` replace the permission override
 * set and `userCategories` replaces the category override set. Sending an
 * empty array clears that set and restores role behaviour, which is what the
 * editor's "reset to role" action sends.
 *
 * `session_version` is bumped so the change is live on the target's very next
 * request, rather than whenever their cookie happens to expire.
 */
export const PUT = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  requireSuperadmin(session);
  const { id } = await params;
  const userId = requiredId(id, 'User ID');
  const user = await loadTargetUser(userId);

  if (user.role === 'superadmin') {
    throw new ApiError(400, 'A superadmin account bypasses every permission check, so overrides cannot restrict it. Change the role instead.');
  }

  const body = await requestJson(request);
  const allow = [...new Set(Array.isArray(body.allowedPermissions) ? body.allowedPermissions : [])];
  const deny = [...new Set(Array.isArray(body.deniedPermissions) ? body.deniedPermissions : [])];
  if (allow.length > 100 || deny.length > 100) throw new ApiError(400, 'Too many permission overrides');

  const conflicting = allow.filter(name => deny.includes(name));
  if (conflicting.length) {
    throw new ApiError(400, `A permission cannot be both allowed and denied: ${conflicting.join(', ')}`);
  }

  const sql = getSql();
  const requested = [...allow, ...deny];
  const permissionRows = requested.length
    ? await sql`SELECT name FROM permissions WHERE name = ANY(${requested})`
    : [];
  const known = new Set(permissionRows.map(row => row.name));
  const unknown = requested.filter(name => !known.has(name));
  if (unknown.length) throw new ApiError(400, `Unknown permission: ${unknown.join(', ')}`);

  // Omitted userCategories means "leave the category scope alone", so the
  // editor can save permissions without touching categories and vice versa.
  const replaceCategories = Array.isArray(body.userCategories);
  const categoryIds = replaceCategories ? optionalIdList(body.userCategories, 'Categories') : null;
  if (categoryIds && categoryIds.length) {
    const categoryRows = await sql`SELECT id FROM categories WHERE id = ANY(${categoryIds}) AND archived_at IS NULL`;
    if (categoryRows.length !== categoryIds.length) throw new ApiError(400, 'One or more categories are invalid');
  }

  // `session_version` is deliberately NOT bumped. getFreshSession recomputes
  // permissions from the database on every request, so a new override is live
  // on the target's next request with no re-login. Bumping the version would
  // instead invalidate their session cookie and sign them out.
  await db.transaction(txn => {
    const statements = [
      txn`DELETE FROM user_permission_overrides WHERE user_id = ${userId}`,
    ];
    if (allow.length) {
      statements.push(txn`
        INSERT INTO user_permission_overrides (user_id, permission_id, effect, created_by)
        SELECT ${userId}, p.id, 'allow', ${session.id}
        FROM permissions p
        WHERE p.name = ANY(${allow})
      `);
    }
    if (deny.length) {
      statements.push(txn`
        INSERT INTO user_permission_overrides (user_id, permission_id, effect, created_by)
        SELECT ${userId}, p.id, 'deny', ${session.id}
        FROM permissions p
        WHERE p.name = ANY(${deny})
      `);
    }
    if (replaceCategories) {
      statements.push(txn`DELETE FROM user_categories WHERE user_id = ${userId}`);
      if (categoryIds.length) {
        statements.push(txn`
          INSERT INTO user_categories (user_id, category_id)
          SELECT ${userId}, c.id FROM categories c WHERE c.id = ANY(${categoryIds})
        `);
      }
    }
    return statements;
  });

  return NextResponse.json(permissionState(await loadTargetUser(userId)));
});

/**
 * Clear every override for a user, restoring role-only behaviour.
 */
export const DELETE = withApi(async (request, { params }) => {
  const session = await getFreshSession();
  requireSuperadmin(session);
  const { id } = await params;
  const userId = requiredId(id, 'User ID');
  await db.transaction(txn => [
    txn`DELETE FROM user_permission_overrides WHERE user_id = ${userId}`,
    txn`DELETE FROM user_categories WHERE user_id = ${userId}`,
  ]);
  return NextResponse.json(permissionState(await loadTargetUser(userId)));
});

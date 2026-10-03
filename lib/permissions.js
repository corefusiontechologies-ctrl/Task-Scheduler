// Permission resolution shared by the role admin API and the per-user
// override API.
//
// Permissions come from two places: the user's role (`role_permissions`) and
// per-user overrides (`user_permission_overrides`). An override either allows
// a permission the role does not grant, or denies one the role does grant.
// Deny always wins, so an override can only ever narrow or widen a role, and
// a conflicting allow+deny on the same permission resolves to deny.

export const LEGACY_PERMISSIONS = {
  perm_add_tasks: 'create_tasks',
  perm_edit_tasks: 'edit_tasks',
  perm_delete_tasks: 'delete_tasks',
  perm_view_all_tasks: 'view_all_tasks',
  perm_view_client_links: 'view_client_links',
  perm_manage_availability: 'manage_availability',
  perm_manage_invoices: 'manage_invoices',
};

// Permissions that are meaningless without a base permission to act on.
// Granting `create_tasks` without `view_tasks` produces an account that can
// create work it can never see, so the base permission is implied.
const IMPLIED = [
  {
    trigger: ['view_all_tasks', 'create_tasks', 'edit_tasks', 'edit_own_tasks', 'delete_tasks'],
    grants: ['view_tasks'],
  },
  {
    trigger: ['create_invoices', 'edit_invoices', 'edit_own_invoices', 'record_payments', 'manage_invoices'],
    grants: ['view_invoices'],
  },
  {
    trigger: ['manage_team'],
    grants: ['view_team'],
  },
];

// `manage_invoices` is the umbrella permission: holding it implies the three
// things it is normally paired with.
const UMBRELLA = {
  trigger: 'manage_invoices',
  grants: ['create_invoices', 'edit_invoices', 'record_payments'],
};

/**
 * Add permissions that are implied by the ones already present. Idempotent.
 */
export function addImpliedPermissions(permissions) {
  const result = new Set(permissions);
  for (const rule of IMPLIED) {
    if (rule.trigger.some(permission => result.has(permission))) {
      for (const permission of rule.grants) result.add(permission);
    }
  }
  if (result.has(UMBRELLA.trigger)) {
    for (const permission of UMBRELLA.grants) result.add(permission);
  }
  return [...result];
}

/**
 * Resolve the effective permission list for one user.
 *
 * Order matters: implications are applied to the role set first, so a role
 * that was saved before an implication was introduced still resolves to a
 * coherent set. Overrides are then applied on top - allows add, denies remove,
 * and a deny beats an allow for the same permission. Implications run once
 * more at the end, because allowing `manage_invoices` on its own should still
 * carry `view_invoices`.
 *
 * @param {string[]} rolePermissions permissions granted by the user's role
 * @param {string[]} allow            permissions explicitly allowed for this user
 * @param {string[]} deny             permissions explicitly denied for this user
 * @returns {string[]} effective permissions, sorted, without duplicates
 */
export function resolvePermissions(rolePermissions = [], allow = [], deny = []) {
  const denied = new Set(deny);
  const granted = new Set(addImpliedPermissions(rolePermissions));

  for (const permission of allow) {
    if (!denied.has(permission)) granted.add(permission);
  }
  for (const permission of denied) {
    granted.delete(permission);
  }

  // A deny must survive the final implication pass, otherwise denying
  // `view_tasks` while allowing `create_tasks` would re-add it.
  const result = new Set(addImpliedPermissions([...granted]));
  for (const permission of denied) result.delete(permission);

  return [...result].sort();
}

/**
 * Normalise a raw override payload into validated allow/deny lists.
 * Rejects a permission that appears in both lists rather than silently
 * picking one.
 */
export function normalizeOverrides(allow, deny, isValidPermission) {
  const allowList = [...new Set(allow || [])];
  const denyList = [...new Set(deny || [])];
  const conflicts = allowList.filter(permission => denyList.includes(permission));
  if (conflicts.length) {
    throw new Error(`Permission cannot be both allowed and denied: ${conflicts.join(', ')}`);
  }
  for (const permission of [...allowList, ...denyList]) {
    if (!isValidPermission(permission)) throw new Error(`Unknown permission: ${permission}`);
  }
  return { allow: allowList, deny: denyList };
}

/**
 * The legacy `roles.perm_*` boolean columns are kept in sync with the real
 * permission list. They are compatibility mirrors only - authorization is
 * always enforced from the session's permission list.
 */
export function legacyFlags(permissions) {
  const has = name => permissions.includes(name);
  return {
    perm_add_tasks: has('create_tasks'),
    perm_edit_tasks: has('edit_tasks'),
    perm_delete_tasks: has('delete_tasks'),
    perm_view_all_tasks: has('view_all_tasks'),
    perm_view_client_links: has('view_client_links'),
    perm_manage_availability: has('manage_availability'),
    perm_manage_invoices: has('manage_invoices'),
  };
}

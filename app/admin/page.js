'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { useDarkMode } from '../components/useDarkMode';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';

const PERM_META = [
  { permission: 'view_tasks', label: 'View tasks', desc: 'View tasks' },
  { permission: 'view_all_tasks', label: 'View all tasks', desc: 'View every task' },
  { permission: 'create_tasks', label: 'Create tasks', desc: 'Create new tasks' },
  { permission: 'edit_tasks', label: 'Edit all tasks', desc: 'Edit any task' },
  { permission: 'edit_own_tasks', label: 'Edit assigned tasks', desc: 'Edit tasks assigned to the user' },
  { permission: 'delete_tasks', label: 'Delete tasks', desc: 'Archive tasks' },
  { permission: 'view_team', label: 'View team', desc: 'View team members' },
  { permission: 'manage_team', label: 'Manage team', desc: 'Create and edit team members' },
  { permission: 'view_invoices', label: 'View invoices', desc: 'View invoices' },
  { permission: 'create_invoices', label: 'Create invoices', desc: 'Create invoices' },
  { permission: 'edit_invoices', label: 'Edit all invoices', desc: 'Edit any invoice' },
  { permission: 'edit_own_invoices', label: 'Edit own invoices', desc: 'Edit created invoices' },
  { permission: 'record_payments', label: 'Record payments', desc: 'Record invoice payments' },
  { permission: 'manage_invoices', label: 'Manage invoices', desc: 'Create, edit, archive, and send invoices' },
  { permission: 'view_client_links', label: 'Client links', desc: 'Create and copy client links' },
  { permission: 'view_client_portal', label: 'Client portal', desc: 'View the client portal' },
  { permission: 'view_dashboard', label: 'View dashboard', desc: 'View the operational dashboard' },
  { permission: 'view_activity', label: 'View activity', desc: 'View activity history' },
  { permission: 'manage_availability', label: 'Manage availability', desc: 'Manage availability settings' },
  { permission: 'manage_booking_requests', label: 'Booking requests', desc: 'Review, confirm, or decline booking requests' },
  { permission: 'manage_categories', label: 'Manage categories', desc: 'Manage task categories' },
  { permission: 'manage_roles', label: 'Manage roles', desc: 'Manage roles and permissions' },
  { permission: 'manage_users', label: 'Manage users', desc: 'Manage user accounts' },
  { permission: 'manage_settings', label: 'Manage settings', desc: 'Manage application settings' },
];

const ROLE_COLORS = ['#D8602A','#2E7BC4','#4F8A22','#8B5CF6','#B5790F','#E91E8C','#00897B','#546E7A'];

async function readApiResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function formatLastLogin(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const now = Date.now();
  const diffMs = now - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes >= 0 && minutes < 1) return 'just now';
  if (minutes >= 0 && minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(diffMs / 3600000);
  if (hours >= 0 && hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (diffMs >= 0 && diffMs < 7 * 86400000) return `${Math.round(diffMs / 86400000)} days ago`;
  return `${day} at ${time}`;
}

function emptyRole() {
  return { name: '', description: '', color: '#2E7BC4', permissions: [], allowedCategories: [] };
}

export default function AdminPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [dark, toggleDark] = useDarkMode();
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const [users, setUsers]         = useState([]);
  const [roles, setRoles]         = useState([]);
  const [categories, setCategories] = useState([]);
  const [team, setTeam]           = useState([]);
  const [tasks, setTasks]         = useState([]);

  const [userForm, setUserForm]   = useState({ name:'', username:'', password:'', role_id:'', theme:'auto', active:true });
  const [editUser, setEditUser]   = useState(null);
  const [userError, setUserError] = useState('');

  // Per-user permission override editor.
  const [permTarget, setPermTarget]     = useState(null);
  const [permForm, setPermForm]         = useState(null);
  const [permError, setPermError]       = useState('');
  const [permSaving, setPermSaving]     = useState(false);

  const [roleForm, setRoleForm]   = useState(emptyRole());
  const [editRole, setEditRole]   = useState(null);
  const [roleError, setRoleError] = useState('');

  const [catForm, setCatForm]     = useState({ name:'', color:'#2E7BC4' });
  const [editCat, setEditCat]     = useState(null);
  const [catError, setCatError]   = useState('');

  const [memberForm, setMemberForm] = useState({ name:'', role:'', user_id:'', email:'' });
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [teamError, setTeamError]   = useState('');

  const [taskMsg, setTaskMsg]     = useState('');
  const [taskError, setTaskError] = useState('');

  useEffect(() => { loadAll(); loadStats(); }, []);

  async function loadStats() {
    setLoadingStats(true);
    try {
      setStats(await readApiResponse(await fetch('/api/admin/stats')));
    } catch {
      setStats(null);
    } finally {
      setLoadingStats(false);
    }
  }

  async function loadAll() {
    try {
      const [u, r, c, m, t] = await Promise.all([
        fetch('/api/admin/users').then(readApiResponse),
        fetch('/api/admin/roles').then(readApiResponse),
        fetch('/api/admin/categories').then(readApiResponse),
        fetch('/api/team').then(readApiResponse),
        fetch('/api/tasks').then(readApiResponse),
      ]);
      setUsers(Array.isArray(u.users) ? u.users : []);
      setRoles(Array.isArray(r) ? r : []);
      setCategories(Array.isArray(c) ? c : []);
      setTeam(Array.isArray(m) ? m : []);
      setTasks(Array.isArray(t) ? t : []);
    } catch (error) {
      setTaskError(error.message);
    }
  }

  async function handleLogout() {
    await fetch('/api/logout', { method:'POST' });
    router.push('/login'); router.refresh();
  }

  // ── Users ──────────────────────────────────────────────────────────
  async function submitUser() {
    setUserError('');
    const source = editUser || userForm;
    const payload = {
      name: source.name,
      username: source.username,
      password: source.password || undefined,
      role_id: source.role_id,
      theme: source.theme || 'auto',
      active: source.active !== false,
    };
    const url = editUser ? `/api/admin/users/${editUser.id}` : '/api/admin/users';
    const method = editUser ? 'PUT' : 'POST';
    try {
      await readApiResponse(await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }));
      toast.success(editUser ? 'User updated.' : 'User created.');
      setUserForm({ name:'', username:'', password:'', role_id:'', theme:'auto', active:true });
      setEditUser(null);
      await loadAll();
    } catch (error) {
      setUserError(error.message);
    }
  }
  async function deleteUser(id) {
    const user = users.find(item => String(item.id) === String(id));
    if (!(await confirm(`Remove ${user?.username || 'this user'}?`, { detail: 'The account is archived and can be restored later. Their tasks and history are kept.' }))) return;
    try {
      await readApiResponse(await fetch(`/api/admin/users/${id}`, { method:'DELETE' }));
      toast.success('User removed.');
      await loadAll();
    } catch (error) {
      setUserError(error.message);
    }
  }

  // ── Per-user permission overrides ────────────────────────────────────
  // Each permission is a three-state control: "From role" (no override, the
  // role decides), "Always allow" (added regardless of role) and "Never"
  // (removed regardless of role). This is what makes it possible to say
  // "this person can edit tasks but never invoices" without inventing a role.

  const OVERRIDE_INHERIT = 'inherit';
  const OVERRIDE_ALLOW = 'allow';
  const OVERRIDE_DENY = 'deny';

  function overrideState(form, permission) {
    if (form.allowedPermissions.includes(permission)) return OVERRIDE_ALLOW;
    if (form.deniedPermissions.includes(permission)) return OVERRIDE_DENY;
    return OVERRIDE_INHERIT;
  }

  function setOverrideState(permission, next) {
    setPermForm(prev => {
      if (!prev) return prev;
      const without = list => list.filter(item => item !== permission);
      let allowedPermissions = without(prev.allowedPermissions);
      let deniedPermissions = without(prev.deniedPermissions);
      if (next === OVERRIDE_ALLOW) allowedPermissions = [...allowedPermissions, permission];
      if (next === OVERRIDE_DENY) deniedPermissions = [...deniedPermissions, permission];
      return { ...prev, allowedPermissions, deniedPermissions };
    });
  }

  async function openPermissionEditor(user) {
    setPermError('');
    setPermTarget(user);
    setPermForm(null);
    try {
      const state = await readApiResponse(await fetch(`/api/admin/users/${user.id}/permissions`));
      setPermForm({
        username: state.username,
        role: state.role,
        isSuperAdmin: state.isSuperAdmin,
        rolePermissions: state.rolePermissions || [],
        allowedPermissions: state.allowedPermissions || [],
        deniedPermissions: state.deniedPermissions || [],
        userCategories: state.userCategories || [],
        // Categories deliberately not touched until the user edits them, so
        // saving permissions alone leaves the category scope inherited.
        categoriesDirty: false,
      });
    } catch (error) {
      setPermError(error.message);
      setPermTarget(null);
    }
  }

  function closePermissionEditor() {
    setPermTarget(null);
    setPermForm(null);
    setPermError('');
  }

  function toggleUserCategory(categoryId) {
    setPermForm(prev => {
      if (!prev) return prev;
      const id = String(categoryId);
      const has = prev.userCategories.includes(id);
      return {
        ...prev,
        userCategories: has ? prev.userCategories.filter(item => item !== id) : [...prev.userCategories, id],
        categoriesDirty: true,
      };
    });
  }

  async function savePermissionOverrides() {
    if (!permTarget || !permForm) return;
    setPermError('');
    setPermSaving(true);
    try {
      const payload = {
        allowedPermissions: permForm.allowedPermissions,
        deniedPermissions: permForm.deniedPermissions,
      };
      // Only send categories when they were actually edited, so saving
      // permissions cannot silently wipe a category scope.
      if (permForm.categoriesDirty) payload.userCategories = permForm.userCategories;
      await readApiResponse(await fetch(`/api/admin/users/${permTarget.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }));
      toast.success(`Permissions updated for ${permForm.username}.`);
      closePermissionEditor();
      await loadAll();
    } catch (error) {
      setPermError(error.message);
    } finally {
      setPermSaving(false);
    }
  }

  async function resetPermissionOverrides() {
    if (!permTarget) return;
    const name = permForm?.username || permTarget.username;
    if (!(await confirm(`Reset all permission overrides for ${name}?`, { detail: 'They will go back to exactly what their role allows. This cannot be undone.', tone: 'danger' }))) return;
    setPermError('');
    setPermSaving(true);
    try {
      await readApiResponse(await fetch(`/api/admin/users/${permTarget.id}/permissions`, { method: 'DELETE' }));
      toast.success(`${name} is back to their role's permissions.`);
      closePermissionEditor();
      await loadAll();
    } catch (error) {
      setPermError(error.message);
    } finally {
      setPermSaving(false);
    }
  }

  // ── Roles ──────────────────────────────────────────────────────────
  function toggleRolePermission(setForm, permission) {
    setForm(form => {
      const permissions = form.permissions || [];
      return { ...form, permissions: permissions.includes(permission) ? permissions.filter(item => item !== permission) : [...permissions, permission] };
    });
  }
  async function submitRole() {
    setRoleError('');
    const source = editRole || roleForm;
    const payload = {
      name: source.name,
      description: source.description || '',
      color: source.color,
      permissions: source.permissions || [],
      allowedCategories: source.allowedCategories || [],
    };
    const url = editRole ? `/api/admin/roles/${editRole.id}` : '/api/admin/roles';
    const method = editRole ? 'PUT' : 'POST';
    try {
      await readApiResponse(await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }));
      toast.success(editRole ? 'Role updated.' : 'Role created.');
      setRoleForm(emptyRole());
      setEditRole(null);
      await loadAll();
    } catch (error) {
      setRoleError(error.message);
    }
  }
  async function deleteRole(id) {
    const role = roles.find(item => String(item.id) === String(id));
    if (!(await confirm(`Delete the "${role?.name || 'this'}" role?`, { detail: 'The role is archived and can be restored later. A role can only be deleted once no users are assigned to it.' }))) return;
    try {
      await readApiResponse(await fetch(`/api/admin/roles/${id}`, { method:'DELETE' }));
      toast.success('Role deleted.');
      await loadAll();
    } catch (error) {
      setRoleError(error.message);
    }
  }

  // ── Categories ─────────────────────────────────────────────────────
  async function submitCat() {
    setCatError('');
    const payload = editCat || catForm;
    const url = editCat ? `/api/admin/categories/${editCat.id}` : '/api/admin/categories';
    const method = editCat ? 'PUT' : 'POST';
    try {
      await readApiResponse(await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }));
      toast.success(editCat ? 'Category updated.' : 'Category created.');
      setCatForm({ name:'', color:'#2E7BC4' });
      setEditCat(null);
      await loadAll();
    } catch (error) {
      setCatError(error.message);
    }
  }
  async function deleteCat(id) {
    const category = categories.find(item => String(item.id) === String(id));
    if (!(await confirm(`Delete the "${category?.name || 'this'}" category?`, { detail: 'The category is archived and can be restored later. Existing tasks keep their current category.' }))) return;
    try {
      await readApiResponse(await fetch(`/api/admin/categories/${id}`, { method:'DELETE' }));
      await loadAll();
    } catch (error) {
      setCatError(error.message);
    }
  }

  // ── Team ───────────────────────────────────────────────────────────
  async function saveMember() {
    setTeamError('');
    if (!memberForm.name.trim()) { setTeamError('Name is required.'); return; }
    const url = editingMemberId ? `/api/team/${editingMemberId}` : '/api/team';
    const method = editingMemberId ? 'PUT' : 'POST';
    try {
      await readApiResponse(await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(memberForm) }));
      toast.success(editingMemberId ? 'Team member updated.' : 'Team member added.');
      setMemberForm({ name:'', role:'', user_id:'', email:'' });
      setEditingMemberId(null);
      await loadAll();
    } catch (error) {
      setTeamError(error.message);
    }
  }
  function startEditMember(m) {
    setEditingMemberId(m.id);
    setMemberForm({ name: m.name, role: m.role||'', user_id: m.user_id||'', email: m.email||'' });
    setTeamError('');
  }
  function cancelEditMember() {
    setEditingMemberId(null);
    setMemberForm({ name:'', role:'', user_id:'', email:'' });
    setTeamError('');
  }
  async function deleteMember(id) {
    const member = team.find(item => String(item.id) === String(id));
    const openCount = tasks.filter(task => {
      if (task.status === 'done') return false;
      const ids = task.assignee_ids || (task.assigned_to ? [String(task.assigned_to)] : []);
      return ids.some(assignee => String(assignee) === String(id));
    }).length;
    const detail = openCount
      ? `${member?.name || 'This member'} still has ${openCount} open task${openCount > 1 ? 's' : ''}. Those assignments stay in place, so the work will not appear as available. Reassign them first if needed.`
      : 'The team member is archived and can be restored later.';
    if (!(await confirm(`Remove ${member?.name || 'this team member'} from the team?`, { tone: openCount ? 'danger' : 'neutral', detail }))) return;
    try {
      await readApiResponse(await fetch('/api/team', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) }));
      toast.success('Team member removed.');
      if (editingMemberId === id) cancelEditMember();
      await loadAll();
    } catch (error) {
      setTeamError(error.message);
    }
  }

  // ── Tasks ──────────────────────────────────────────────────────────
  async function deleteTask(id) {
    setTaskMsg('');
    setTaskError('');
    const task = tasks.find(item => String(item.id) === String(id));
    if (!(await confirm('Permanently delete this completed task?', { tone: 'danger', detail: `This cannot be undone. "${task?.title || 'This task'}" and its history will be removed for good.` }))) return;
    try {
      await readApiResponse(await fetch(`/api/tasks/${id}?permanent=1`, { method:'DELETE' }));
      setTaskMsg('Task deleted permanently.');
      await loadAll();
    } catch (error) {
      setTaskError(error.message);
    }
  }

  const doneTasks = tasks.filter(t => t.status === 'done');

  // ── Helpers ────────────────────────────────────────────────────────
  const activeRoleForm = editRole || roleForm;
  const setActiveRoleForm = editRole ? setEditRole : setRoleForm;
  const roleById = new Map(roles.map(role => [String(role.id), role]));

  const navItems = [
    { key: 'overview', label: 'Overview', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg> },
    { key: 'users', label: 'Users', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
    { key: 'roles', label: 'Roles & Permissions', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> },
    { key: 'categories', label: 'Categories', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
    { key: 'team', label: 'Team', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
    { key: 'tasks', label: 'Done tasks', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>, badge: doneTasks.length > 0 ? doneTasks.length : null },
  ];

  return (
    <div className="app-shell">
      <Sidebar
        items={navItems}
        activeKey={tab}
        onSelect={setTab}
        dark={dark}
        onToggleDark={toggleDark}
        onSignOut={handleLogout}
        badgeText="Super Admin"
        extraLink={{ label: 'Dashboard →', onClick: () => router.push('/dashboard') }}
      />

      <div className="app-main">
      <div className="container app">

        {/* ── OVERVIEW ── */}
        {tab==='overview' && (
          <div className="card">
            <strong style={{fontSize:16}}>Overview</strong>
            <p className="muted" style={{fontSize:13,marginTop:4}}>A quick snapshot across the whole workspace.</p>

            {loadingStats && (
              <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:16}}>
                {Array.from({length:5}).map((_,i) => (
                  <div key={i} style={{flex:'1 1 150px',background:'var(--accent-soft)',borderRadius:10,padding:'12px 16px'}}>
                    <div className="skeleton" style={{width:40,height:24,borderRadius:6,marginBottom:8}} />
                    <div className="skeleton" style={{width:80,height:10,borderRadius:6}} />
                  </div>
                ))}
              </div>
            )}

            {!loadingStats && !stats && (
              <p style={{color:'#c0392b',background:'#fdecea',padding:'8px 12px',borderRadius:8,fontSize:13,marginTop:16}}>
                Could not load stats. Try refreshing.
              </p>
            )}

            {!loadingStats && stats && (
              <>
                <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:16}}>
                  {[
                    ['Completed this week', stats.tasksCompletedThisWeek, 'var(--done)'],
                    ['Overdue', stats.overdueCount, '#c0392b'],
                    ['Due this week', stats.dueThisWeekCount, 'var(--review)'],
                    ['Active tasks', stats.activeTaskCount, 'var(--in_progress)'],
                    ['Unpaid invoices', stats.unpaidInvoiceCount, '#B5790F'],
                  ].map(([label,val,color]) => (
                    <div key={label} style={{flex:'1 1 150px',background:'var(--accent-soft)',borderRadius:10,padding:'12px 16px'}}>
                      <div style={{fontSize:24,fontWeight:800,color}}>{val}</div>
                      <div className="muted" style={{fontSize:12}}>{label}</div>
                    </div>
                  ))}
                </div>

                <div style={{marginTop:24}}>
                  <strong style={{fontSize:14}}>Revenue collected this month</strong>
                  <p className="muted" style={{fontSize:12,marginTop:2}}>
                    Amount marked paid on invoices dated this month, grouped by currency.
                  </p>
                  {stats.revenueByCurrency.length === 0 && (
                    <p className="muted" style={{fontSize:13,marginTop:8}}>No invoices dated this month yet.</p>
                  )}
                  {stats.revenueByCurrency.map(r => (
                    <div key={r.currency} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                      padding:'10px 0',borderBottom:'1px solid var(--line)'}}>
                      <span style={{fontWeight:600,fontSize:13}}>{r.currency}</span>
                      <span style={{fontSize:13}}>
                        {r.collectedThisMonth.toFixed(2)} collected
                        <span className="muted"> · {r.invoicesThisMonth} invoice{r.invoicesThisMonth===1?'':'s'} this month</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── USERS ── */}
        {tab==='users' && (
          <div className="card">
            <strong style={{fontSize:16}}>Manage users</strong>
            <p className="muted" style={{fontSize:13,marginTop:4}}>Create login accounts and assign roles to control what each person can do.</p>
            {userError && <p style={{color:'#c0392b',background:'#fdecea',padding:'8px 12px',borderRadius:8,fontSize:13,marginTop:8}}>{userError}</p>}

            {/* Form */}
            <div style={{background:'var(--share-bg)',borderRadius:10,padding:'1rem',margin:'1rem 0'}}>
              <strong style={{fontSize:14}}>{editUser ? 'Edit user' : 'Add new user'}</strong>
              <div className="form-grid" style={{marginTop:10}}>
                <div><label>Full name</label>
                  <input value={(editUser||userForm).name||''} onChange={e=>editUser?setEditUser(p=>({...p,name:e.target.value})):setUserForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Ali Hassan" /></div>
                <div><label>Username</label>
                  <input value={(editUser||userForm).username||''} onChange={e=>editUser?setEditUser(p=>({...p,username:e.target.value})):setUserForm(p=>({...p,username:e.target.value}))} placeholder="e.g. ali_hassan" /></div>
                <div><label>{editUser?'New password (blank = keep)':'Password'}</label>
                  <input type="password" value={(editUser||userForm).password||''} onChange={e=>editUser?setEditUser(p=>({...p,password:e.target.value})):setUserForm(p=>({...p,password:e.target.value}))} placeholder="••••••••" /></div>
                <div><label>Role</label>
                  <select value={(editUser||userForm).role_id||''} onChange={e=>editUser?setEditUser(p=>({...p,role_id:e.target.value||null})):setUserForm(p=>({...p,role_id:e.target.value||null}))}>
                    <option value="">Select a role</option>
                    {roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                  </select></div>
                <div><label>Theme</label>
                  <select value={(editUser||userForm).theme||'auto'} onChange={e=>editUser?setEditUser(p=>({...p,theme:e.target.value})):setUserForm(p=>({...p,theme:e.target.value}))}>
                    <option value="auto">System default</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select></div>
              </div>
              <div style={{display:'flex',gap:8,marginTop:8}}>
                <button onClick={submitUser}>{editUser?'Save changes':'Add user'}</button>
                {editUser && <button className="secondary" onClick={()=>setEditUser(null)}>Cancel</button>}
              </div>
            </div>

            {/* List */}
            {users.length===0 && <p className="muted">No users yet.</p>}
            {users.map(u=>{
              const role = roleById.get(String(u.role_id));
              const isSuperAdmin = u.role === 'superadmin';
              const displayName = u.name || u.username;
              return (
                <div key={u.id} className="task-row">
                  <div style={{display:'flex',alignItems:'center',gap:10,flex:1,minWidth:0}}>
                    <div style={{width:36,height:36,borderRadius:'50%',background:isSuperAdmin?'var(--accent)':'var(--accent-soft)',
                      display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:14,
                      color:isSuperAdmin?'var(--on-accent)':'var(--accent)',flexShrink:0}}>{displayName[0].toUpperCase()}</div>
                    <div style={{minWidth:0}}>
                      <div style={{fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{displayName}</div>
                      <div className="muted" style={{fontSize:12,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                        @{u.username}
                        <span style={{background:isSuperAdmin?'var(--accent)':role?.color||'var(--line)',color:isSuperAdmin?'var(--on-accent)':'var(--ink)',padding:'1px 7px',borderRadius:10,fontSize:11}}>{isSuperAdmin?'Super Admin':role?.name||u.role||'No role'}</span>
                        {!u.active && <span style={{background:'var(--line)',color:'var(--ink-soft)',padding:'1px 7px',borderRadius:10,fontSize:11}}>Inactive</span>}
                        {u.hasOverrides && <span style={{background:'var(--accent-soft)',color:'var(--rail-admin-ink)',padding:'1px 7px',borderRadius:10,fontSize:11}} title="This person has permission overrides on top of their role">Custom</span>}
                      </div>
                      <div className="muted" style={{fontSize:11,marginTop:2}}>
                        {u.last_login
                          ? `Last signed in ${formatLastLogin(u.last_login)}`
                          : 'Never signed in'}
                      </div>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    <button className="secondary" onClick={()=>setEditUser({...u,password:''})}>Edit</button>
                    <button className="secondary" onClick={()=>openPermissionEditor(u)}>Permissions</button>
                    <button className="danger" onClick={()=>deleteUser(u.id)}>Remove</button>
                  </div>
                </div>
              );
            })}

            {/* ── Per-user permission editor ── */}
            {permTarget && (
              <div style={{background:'var(--share-bg)',borderRadius:10,padding:'1rem',marginTop:14,border:'1px solid var(--line)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
                  <div>
                    <strong style={{fontSize:14}}>Custom permissions for @{permTarget.username}</strong>
                    <p className="muted" style={{fontSize:12,margin:'2px 0 0'}}>
                      Start from what their role allows, then force anything on or off for this person only.
                    </p>
                  </div>
                  <button className="secondary" onClick={closePermissionEditor}>Close</button>
                </div>

                {permError && <p style={{color:'#c0392b',background:'#fdecea',padding:'8px 12px',borderRadius:8,fontSize:13,marginTop:8}}>{permError}</p>}

                {!permForm && <p className="muted" style={{fontSize:13,marginTop:10}}>Loading…</p>}

                {permForm && permForm.isSuperAdmin && (
                  <p style={{background:'var(--amber-bg)',color:'var(--amber-fg)',padding:'8px 12px',borderRadius:8,fontSize:13,marginTop:10}}>
                    Super admins bypass every permission check, so overrides cannot restrict this account. Change their role to limit what they can do.
                  </p>
                )}

                {permForm && !permForm.isSuperAdmin && (
                  <>
                    <p className="muted" style={{fontSize:12,margin:'10px 0 6px'}}>
                      <strong>From role</strong> is the default. <strong>Always allow</strong> grants it even if the role says no; <strong>Never</strong> blocks it even if the role says yes.
                    </p>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:8}}>
                      {PERM_META.map(p=>{
                        const state = overrideState(permForm, p.permission);
                        const fromRole = permForm.rolePermissions.includes(p.permission);
                        const options = [
                          { key: OVERRIDE_INHERIT, label: 'From role', title: fromRole ? 'Their role allows this' : 'Their role does not allow this' },
                          { key: OVERRIDE_ALLOW, label: 'Always allow', title: 'Granted regardless of role' },
                          { key: OVERRIDE_DENY, label: 'Never', title: 'Blocked regardless of role' },
                        ];
                        return (
                          <div key={p.permission} style={{background:'var(--card)',border:'1px solid var(--line)',borderRadius:8,padding:'8px 10px'}}>
                            <div style={{fontWeight:600,fontSize:13}}>{p.label}</div>
                            <div style={{fontSize:11,color:'var(--ink-soft)',marginTop:2,minHeight:26}}>{p.desc}</div>
                            <div style={{display:'flex',gap:4,marginTop:6,flexWrap:'wrap'}} role="group" aria-label={`${p.label} override`}>
                              {options.map(o=>{
                                const active = state === o.key;
                                const colour = o.key === OVERRIDE_DENY ? 'var(--red-fg)' : o.key === OVERRIDE_ALLOW ? 'var(--green-fg)' : 'var(--ink-soft)';
                                return (
                                  <button key={o.key} type="button" title={o.title} aria-pressed={active}
                                    onClick={()=>setOverrideState(p.permission, o.key)}
                                    style={{padding:'3px 8px',borderRadius:14,cursor:'pointer',fontSize:11,fontWeight:600,
                                      background:active?colour:'transparent',color:active?'var(--card)':'var(--ink-soft)',
                                      border:`1px solid ${active?colour:'var(--line)'}`}}>
                                    {o.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {categories.length > 0 && !permForm.rolePermissions.includes('view_all_tasks') && (
                      <div style={{marginTop:14}}>
                        <label style={{fontSize:13,fontWeight:600,color:'var(--ink)'}}>Category access</label>
                        <p className="muted" style={{fontSize:12,margin:'2px 0 8px'}}>
                          Leave every category off to inherit the role&apos;s categories. Choosing any of them replaces the role&apos;s list for this person only.
                        </p>
                        <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                          {categories.map(c=>{
                            const active = permForm.userCategories.includes(String(c.id));
                            return (
                              <button key={c.id} type="button" aria-pressed={active}
                                onClick={()=>toggleUserCategory(c.id)}
                                style={{padding:'5px 12px',borderRadius:20,cursor:'pointer',fontSize:13,fontWeight:500,
                                  background:active?c.color:'var(--card)',color:active?'var(--on-accent)':'var(--ink)',
                                  border:`1px solid ${active?c.color:'var(--line)'}`}}>
                                {c.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div style={{display:'flex',gap:8,marginTop:14,flexWrap:'wrap'}}>
                      <button onClick={savePermissionOverrides} disabled={permSaving}>
                        {permSaving ? 'Saving…' : 'Save permissions'}
                      </button>
                      <button className="secondary" onClick={resetPermissionOverrides} disabled={permSaving}>Reset to role</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── ROLES ── */}
        {tab==='roles' && (
          <div className="card">
            <strong style={{fontSize:16}}>Roles & permissions</strong>
            <p className="muted" style={{fontSize:13,marginTop:4}}>Create roles and control exactly what each role can see and do.</p>
            {roleError && <p style={{color:'#c0392b',background:'#fdecea',padding:'8px 12px',borderRadius:8,fontSize:13,marginTop:8}}>{roleError}</p>}

            {/* Role form */}
            <div style={{background:'var(--share-bg)',borderRadius:10,padding:'1rem',margin:'1rem 0'}}>
              <strong style={{fontSize:14}}>{editRole?'Edit role':'Create new role'}</strong>
              <div className="form-grid" style={{marginTop:10}}>
                <div><label>Role name</label>
                  <input value={activeRoleForm.name} onChange={e=>setActiveRoleForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Developer" /></div>
                <div><label>Colour</label>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                    {ROLE_COLORS.map(c=>(
                      <button key={c} type="button" aria-label={`Use ${c} for role colour`} aria-pressed={activeRoleForm.color===c}
                        onClick={()=>setActiveRoleForm(p=>({...p,color:c}))}
                        style={{width:28,height:28,borderRadius:'50%',background:c,cursor:'pointer',
                          border:activeRoleForm.color===c?'3px solid var(--ink)':'3px solid transparent',
                          boxSizing:'border-box',padding:0}}/>
                    ))}
                  </div>
                </div>
              </div>

              {/* Permissions toggles */}
              <div style={{marginTop:14}}>
                <label style={{fontSize:13,fontWeight:600,color:'var(--ink)'}}>Permissions</label>
                <div className="perm-grid" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8}}>
                  {PERM_META.map(p=>{
                    const active = activeRoleForm.permissions?.includes(p.permission);
                    return (
                      <button key={p.permission} type="button" aria-pressed={active}
                        onClick={()=>toggleRolePermission(setActiveRoleForm,p.permission)}
                        style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 12px',textAlign:'left',
                          borderRadius:8,border:`1px solid ${active?'var(--accent)':'var(--line)'}`,
                          background:active?'var(--accent-soft)':'var(--card)',color:'var(--ink)',cursor:'pointer'}}>
                        <span aria-hidden="true" style={{width:18,height:18,borderRadius:4,border:`2px solid ${active?'var(--accent)':'var(--line)'}`,
                          background:active?'var(--accent)':'transparent',flexShrink:0,
                          display:'flex',alignItems:'center',justifyContent:'center',color:'var(--on-accent)',fontSize:12,marginTop:1}}>
                          {active && '✓'}
                        </span>
                        <span>
                          <span style={{display:'block',fontWeight:600,fontSize:13}}>{p.label}</span>
                          <span style={{display:'block',fontSize:11,color:'var(--ink-soft)',marginTop:2}}>{p.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Category access */}
              {categories.length > 0 && !activeRoleForm.permissions?.includes('view_all_tasks') && (
                <div style={{marginTop:14}}>
                  <label style={{fontSize:13,fontWeight:600,color:'var(--ink)'}}>Category access</label>
                  <p className="muted" style={{fontSize:12,margin:'2px 0 8px'}}>Since &quot;View all tasks&quot; is off, choose which categories this role can see.</p>
                  <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                    {categories.map(c=>{
                      const active = activeRoleForm.allowedCategories?.includes(c.id);
                      return (
                        <button key={c.id} type="button" aria-pressed={active}
                          onClick={()=>setActiveRoleForm(prev=>{
                            const has = prev.allowedCategories?.includes(c.id);
                            return {...prev, allowedCategories: has ? prev.allowedCategories.filter(x=>x!==c.id) : [...(prev.allowedCategories||[]),c.id]};
                          })}
                          style={{padding:'5px 12px',borderRadius:20,cursor:'pointer',fontSize:13,fontWeight:500,
                            background:active?c.color:'var(--card)',color:active?'var(--on-accent)':'var(--ink)',
                            border:`1px solid ${active?c.color:'var(--line)'}`}}>
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{display:'flex',gap:8,marginTop:14}}>
                <button onClick={submitRole}>{editRole?'Save role':'Create role'}</button>
                {editRole && <button className="secondary" onClick={()=>setEditRole(null)}>Cancel</button>}
              </div>
            </div>

            {/* Roles list */}
            {roles.length===0 && <p className="muted">No roles yet. Create one above.</p>}
            {roles.map(r=>(
              <div key={r.id} className="task-row">
                <div style={{display:'flex',alignItems:'center',gap:10,flex:1,minWidth:0}}>
                  <div style={{width:12,height:12,borderRadius:'50%',background:r.color,flexShrink:0}}></div>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{r.name}</div>
                    <div className="muted" style={{fontSize:12,marginTop:2}}>
                      {PERM_META.filter(p=>r.permissions?.includes(p.permission)).map(p=>p.label).join(' · ') || 'No permissions'}
                    </div>
                  </div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button className="secondary" onClick={()=>setEditRole({...r,permissions:r.permissions||[],allowedCategories:r.allowedCategories||[]})}>Edit</button>
                  <button className="danger" onClick={()=>deleteRole(r.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── CATEGORIES ── */}
        {tab==='categories' && (
          <div className="card">
            <strong style={{fontSize:16}}>Task categories</strong>
            <p className="muted" style={{fontSize:13,marginTop:4}}>Categories group tasks together. Roles can be restricted to only see certain categories.</p>
            {catError && <p style={{color:'#c0392b',background:'#fdecea',padding:'8px 12px',borderRadius:8,fontSize:13,marginTop:8}}>{catError}</p>}

            <div style={{background:'var(--share-bg)',borderRadius:10,padding:'1rem',margin:'1rem 0'}}>
              <strong style={{fontSize:14}}>{editCat?'Edit category':'Add category'}</strong>
              <div className="form-grid" style={{marginTop:10}}>
                <div><label>Name</label>
                  <input value={(editCat||catForm).name} onChange={e=>editCat?setEditCat(p=>({...p,name:e.target.value})):setCatForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Web Development" /></div>
                <div><label>Colour</label>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                    {ROLE_COLORS.map(c=>(
                      <button key={c} type="button" aria-label={`Use ${c} for category colour`} aria-pressed={(editCat||catForm).color===c}
                        onClick={()=>editCat?setEditCat(p=>({...p,color:c})):setCatForm(p=>({...p,color:c}))}
                        style={{width:28,height:28,borderRadius:'50%',background:c,cursor:'pointer',
                          border:(editCat||catForm).color===c?'3px solid var(--ink)':'3px solid transparent',boxSizing:'border-box',padding:0}}/>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{display:'flex',gap:8,marginTop:12}}>
                <button onClick={submitCat}>{editCat?'Save':'Add category'}</button>
                {editCat && <button className="secondary" onClick={()=>setEditCat(null)}>Cancel</button>}
              </div>
            </div>

            {categories.length===0 && <p className="muted">No categories yet.</p>}
            {categories.map(c=>(
              <div key={c.id} className="task-row">
                <div style={{display:'flex',alignItems:'center',gap:10,flex:1,minWidth:0}}>
                  <div style={{width:12,height:12,borderRadius:'50%',background:c.color,flexShrink:0}}></div>
                  <span style={{fontWeight:600}}>{c.name}</span>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button className="secondary" onClick={()=>setEditCat({...c})}>Edit</button>
                  <button className="danger" onClick={()=>deleteCat(c.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── TEAM ── */}
        {tab==='team' && (
          <div className="card">
            <strong style={{fontSize:16}}>Team members</strong>
            <p className="muted" style={{fontSize:13,marginTop:4}}>Team members appear in the task assignment dropdown. Link a user account so tasks filter correctly by their permissions.</p>
            {teamError && <p style={{color:'#c0392b',background:'#fdecea',padding:'8px 12px',borderRadius:8,fontSize:13,marginTop:8}}>{teamError}</p>}

            <div style={{background:'var(--share-bg)',borderRadius:10,padding:'1rem',margin:'1rem 0'}}>
              <strong style={{fontSize:14}}>{editingMemberId ? 'Edit team member' : 'Add team member'}</strong>
              <div className="form-grid" style={{marginTop:10}}>
                <div><label>Name</label>
                  <input value={memberForm.name} onChange={e=>setMemberForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Sara Khan" /></div>
                <div><label>Title (optional)</label>
                  <input value={memberForm.role} onChange={e=>setMemberForm(p=>({...p,role:e.target.value}))} placeholder="e.g. Developer" /></div>
                <div><label>Email (for task notifications)</label>
                  <input type="email" value={memberForm.email} onChange={e=>setMemberForm(p=>({...p,email:e.target.value}))} placeholder="sara@company.com" /></div>
                <div><label>Linked user account (optional)</label>
                  <select value={memberForm.user_id||''} onChange={e=>setMemberForm(p=>({...p,user_id:e.target.value||null}))}>
                    <option value="">— Not linked —</option>
                    {users.filter(u=>u.role !== 'superadmin').map(u=><option key={u.id} value={u.id}>{u.name || u.username} (@{u.username})</option>)}
                  </select>
                </div>
              </div>
              <div style={{display:'flex',gap:8,marginTop:12}}>
                <button onClick={saveMember}>{editingMemberId ? 'Save changes' : 'Add member'}</button>
                {editingMemberId && <button className="secondary" onClick={cancelEditMember}>Cancel</button>}
              </div>
            </div>

            {team.length===0 && <p className="muted">No team members yet.</p>}
            {team.map(m=>(
              <div key={m.id} className="task-row">
                <div style={{display:'flex',alignItems:'center',gap:10,flex:1,minWidth:0}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'var(--accent-soft)',
                    display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:14,color:'var(--accent)',flexShrink:0}}>
                    {m.name[0].toUpperCase()}</div>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{m.name}</div>
                    <div className="muted" style={{fontSize:12}}>{m.role||'No title'}{m.email ? ` · ${m.email}` : ' · No email on file'}</div>
                  </div>
                </div>
                <div style={{display:'flex',gap:8,flexShrink:0}}>
                  <button className="secondary" onClick={()=>startEditMember(m)}>Edit</button>
                  <button className="danger" onClick={()=>deleteMember(m.id)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── DONE TASKS ── */}
        {tab==='tasks' && (
          <div className="card">
            <strong style={{fontSize:16}}>Completed tasks</strong>
            <p className="muted" style={{fontSize:13,marginTop:4}}>Only you (super admin) can permanently delete completed tasks.</p>
            {taskMsg && <p style={{color:'var(--done)',background:'var(--avail-free-bg)',padding:'8px 12px',borderRadius:8,fontSize:13,marginTop:8}}>{taskMsg}</p>}
        {taskError && <p style={{color:'#c0392b',background:'#fdecea',padding:'8px 12px',borderRadius:8,fontSize:13,marginTop:8}}>{taskError}</p>}
            {doneTasks.length===0 && <p className="muted">No completed tasks yet.</p>}
            {doneTasks.map(t=>(
              <div key={t.id} className="task-row">
                <div style={{flex:1}}>
                  <div style={{fontWeight:600}}>{t.task_title}</div>
                  <div className="muted" style={{fontSize:12}}>{t.client_name}{t.category_name?` · ${t.category_name}`:''}</div>
                </div>
                <button className="danger" onClick={()=>deleteTask(t.id)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

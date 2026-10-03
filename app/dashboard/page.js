'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { calcInvoiceTotal } from '@/lib/invoiceMath';
import { safeCsvCell } from '@/lib/csv';
import Sidebar from '../components/Sidebar';
import { useToast } from '../components/Toast';
import { useConfirm, usePrompt } from '../components/ConfirmDialog';
import { useCopy } from '../components/useCopy';
import { useDarkMode } from '../components/useDarkMode';

const STATUS_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  review:      'In review',
  done:        'Done',
};

function assigneeLabel(task) {
  const names = (task.assignee_names || []).filter(Boolean);
  if (names.length) return names.join(', ');
  return task.assigned_name || '';
}

const STATUS_COLORS = {
  not_started: 'var(--not_started)',
  in_progress: 'var(--in_progress)',
  review:      'var(--review)',
  done:        'var(--done)',
};

function fmt(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function todayISO() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

async function readApiResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

const PERMISSION_FLAGS = {
  perm_add_tasks: 'create_tasks',
  perm_edit_tasks: 'edit_tasks',
  perm_edit_own_tasks: 'edit_own_tasks',
  perm_delete_tasks: 'delete_tasks',
  perm_view_all_tasks: 'view_all_tasks',
  perm_view_client_links: 'view_client_links',
  perm_manage_invoices: 'manage_invoices',
  perm_view_invoices: 'view_invoices',
  perm_create_invoices: 'create_invoices',
  perm_record_payments: 'record_payments',
  perm_edit_invoices: 'edit_invoices',
  perm_edit_own_invoices: 'edit_own_invoices',
  perm_view_team: 'view_team',
  perm_manage_availability: 'manage_availability',
  perm_manage_booking_requests: 'manage_booking_requests',
};

function permissionFlags(user) {
  const permissions = user?.permissions || [];
  return Object.fromEntries(Object.entries(PERMISSION_FLAGS).map(([flag, permission]) => [flag, permissions.includes(permission)]));
}

const TASK_PAYMENT_LABELS = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
};

export default function DashboardPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const copy = useCopy();
  const [tab, setTab] = useState('list');

  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestsError, setRequestsError] = useState('');
  const [tasks, setTasks] = useState([]);
  const [team, setTeam] = useState([]);
  const [categories, setCategories] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const [dark, toggleDark] = useDarkMode();
  const [copied, setCopied] = useState(null);
    const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [userId, setUserId] = useState('');
  const [perms, setPerms] = useState({});
  const [displayName, setDisplayName] = useState('there');
  const [trashTasks, setTrashTasks] = useState([]);
  const [trashInvoices, setTrashInvoices] = useState([]);
  const [loadingTrash, setLoadingTrash] = useState(false);
  const [activityItems, setActivityItems] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [portalCopied, setPortalCopied] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    fetch('/api/me')
      .then(readApiResponse)
      .then(data => {
        const user = data.user || {};
        setUserId(String(user.id || ''));
        setIsSuperAdmin(user.role === 'superadmin');
        setPerms(permissionFlags(user));
        // `name` is the field the Settings page saves and the one
        // getFreshSession returns. display_name/full_name were never
        // populated, so reading only those left the greeting and the
        // sidebar showing the raw username.
        setDisplayName(user.name || user.display_name || user.full_name || user.username || 'there');
      })
      .catch(error => setLoadError(error.message));
    loadAll();
  }, []);

  async function loadAll() {
    setLoadError('');
    try {
      const optionalTeam = fetch('/api/team').then(readApiResponse).catch(error => {
        if (error.status === 403) return [];
        throw error;
      });
      const [t, m, c, inv] = await Promise.all([
        fetch('/api/tasks').then(readApiResponse),
        optionalTeam,
        fetch('/api/categories').then(readApiResponse),
        fetch('/api/invoices').then(readApiResponse).catch(error => {
          if (error.status === 403) return [];
          throw error;
        }),
      ]);
      setTasks(Array.isArray(t) ? t : []);
      setTeam(Array.isArray(m) ? m : []);
      setCategories(Array.isArray(c) ? c : []);
      setInvoices(Array.isArray(inv) ? inv : []);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  async function saveTask(form) {
    const assigneeIds = [...new Set((form.assignee_ids || (form.assigned_to ? [form.assigned_to] : []))
      .map(value => String(value))
      .filter(value => /^\d+$/.test(value)))];
    const payload = {
      title: form.task_title,
      description: form.description || '',
      notes: form.notes || '',
      client_name: form.client_name,
      assigned_to: assigneeIds.length ? assigneeIds[0] : null,
      assignee_ids: assigneeIds,
      category_id: form.category_id ? String(form.category_id) : null,
      start_date: form.start_date,
      due_date: form.due_date,
      status: form.status,
      payment_status: form.payment_status || 'unpaid',
      amount_paid: Number(form.amount_paid || 0),
      client_visible: !!form.client_visible,
      project_name: form.project_name || '',
      client_email: form.client_email || '',
      priority: form.priority || 'medium',
    };
    // A completed task is locked server side, so a full PUT is refused while it
    // is still `done`. Two cases have to be handled against the *stored*
    // status, not the form value: settling payment on a finished task, and
    // reopening it (which must happen before any other field can change).
    const storedDone = Boolean(editing?.id) && editing.status === 'done';
    let expected = editing?.updated_at;
    let response;

    if (storedDone && form.status === 'done') {
      // Still completed: only payment may change.
      response = await fetch(`/api/tasks/${editing.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_status: form.payment_status || 'unpaid',
          amount_paid: Number(form.amount_paid || 0),
          expected,
        }),
      });
    } else {
      if (storedDone) {
        // Reopen first, then the ordinary full edit becomes possible.
        const reopened = await readApiResponse(await fetch(`/api/tasks/${editing.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: form.status, expected }),
        }));
        expected = reopened.updated_at;
      }
      response = editing?.id
        ? await fetch(`/api/tasks/${editing.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, expected }),
          })
        : await fetch('/api/tasks', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
          });
    }
    await readApiResponse(response);
    setShowForm(false);
    setEditing(null);
    toast.success(editing?.id ? 'Task updated.' : 'Task created.');
    loadAll();
  }

  async function deleteTask(id, status) {
    if (status === 'done' && !isSuperAdmin) {
      toast.error('Only the super admin can delete completed tasks.');
      return;
    }
    if (!isSuperAdmin && !perms.perm_delete_tasks) {
      toast.error('You do not have permission to delete tasks.');
      return;
    }
    if (!(await confirm('Delete this task?', { detail: 'The task moves to trash and can be restored later.' }))) return;
    try {
      const response = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
      await readApiResponse(response);
      toast.success('Task moved to trash.');
      loadAll();
    } catch (error) {
      toast.error(error.message);
    }
  }

  // Bulk status change: reuse the single-task PUT endpoint (which already
  // handles permission checks, activity logging, and assignee/client emails)
  // so bulk edits go through the exact same rules as a one-off edit.
  async function bulkUpdateStatus(ids, status) {
    if (ids.length === 0) return;
    if (!(await confirm(`Change status to "${STATUS_LABELS[status]}" for ${ids.length} task${ids.length>1?'s':''}?`))) return;
    const updates = ids.map(id => {
      const task = tasks.find(item => item.id === id);
      return task ? { id, status, progress: status === 'done' ? 100 : task.progress, expected: task.updated_at } : null;
    }).filter(Boolean);
    if (updates.length === 0) { toast.error('None of the selected tasks could be found. Refresh and try again.'); return; }
    try {
      for (let start = 0; start < updates.length; start += 100) {
        const response = await fetch('/api/tasks', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: updates.slice(start, start + 100) }),
        });
        await readApiResponse(response);
      }
    } catch (error) {
      toast.error(`Could not update the status. ${error.message}`);
      return;
    }
    toast.success(`${updates.length} task${updates.length>1?'s':''} set to ${STATUS_LABELS[status]}.`);
    loadAll();
  }

  // ── Board: move a single task between status columns ──────────────
  // Optimistic: the card moves immediately and rolls back if the
  // server rejects it (stale updated_at, missing permission, ...).
  async function moveTaskToStatus(task, status) {
    if (!task || task.status === status) return;
    const previous = task.status;
    const previousProgress = task.progress;
    setTasks(items => items.map(item => item.id === task.id
      ? { ...item, status, progress: status === 'done' ? 100 : item.progress }
      : item));
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          progress: status === 'done' ? 100 : task.progress,
          expected: task.updated_at,
        }),
      });
      const updated = await readApiResponse(response);
      setTasks(items => items.map(item => item.id === task.id
        ? { ...item, ...(updated || {}), status, progress: status === 'done' ? 100 : item.progress }
        : item));
      toast.success(`"${task.task_title}" moved to ${STATUS_LABELS[status]}.`);
    } catch (error) {
      setTasks(items => items.map(item => item.id === task.id
        ? { ...item, status: previous, progress: previousProgress }
        : item));
      toast.error(`Could not move "${task.task_title}". ${error.message}`, {
        detail: 'The task was put back where it was.',
      });
    }
  }

  async function bulkTrash(ids) {
    if (ids.length === 0) return;
    const blocked = ids.filter(id => { const t = tasks.find(x=>x.id===id); return t?.status === 'done' && !isSuperAdmin; });
    const doable = ids.filter(id => !blocked.includes(id));
    if (doable.length === 0) { toast.error('Only the super admin can trash completed tasks.'); return; }
    if (!(await confirm(`Move ${doable.length} task${doable.length>1?'s':''} to trash?`, { detail: blocked.length ? `${blocked.length} completed task(s) will be skipped — super admin only.` : undefined }))) return;
    await Promise.all(doable.map(id => fetch(`/api/tasks/${id}`, { method:'DELETE' }).then(readApiResponse)));
    toast.success(`${doable.length} task${doable.length>1?'s':''} moved to trash.`);
    loadAll();
  }

  function openNewForm() {
    setEditing({ client_name:'', task_title:'', assigned_to:'', assignee_ids:[], category_id:'', start_date:'', due_date:'', status:'not_started', payment_status:'unpaid', amount_paid:0, description:'', notes:'', client_email:'', project_name:'', client_visible:false, priority:'medium' });
    setShowForm(true);
  }

  function openEditForm(t) {
    setEditing({
      id: t.id, client_name: t.client_name, task_title: t.task_title,
      assigned_to: t.assigned_to || '', assignee_ids: (t.assignee_ids || (t.assigned_to ? [t.assigned_to] : [])).map(String), category_id: t.category_id || '',
      start_date: t.start_date?.slice(0,10), due_date: t.due_date?.slice(0,10),
      status: t.status, payment_status: t.payment_status || 'unpaid', amount_paid: t.amount_paid || 0,
      description: t.description || '', notes: t.notes || '', client_email: t.client_email || '', project_name: t.project_name || '',
      client_visible: !!t.client_visible, priority: t.priority || 'medium', updated_at: t.updated_at,
    });
    setShowForm(true);
  }

  async function copyLink(token) {
    const copied = await copy(`${origin}/client/${token}`);
    if (copied) {
      setCopied(token);
      setTimeout(() => setCopied(null), 1800);
    }
  }

  async function changeShareLink(kind, item, action) {
    const isTask = kind === 'task';
    const label = isTask ? `"${item.task_title}"` : `invoice ${item.invoice_number}`;
    const regenerate = action === 'regenerate_share';
    const question = regenerate
      ? `Create a new share link for ${label}?`
      : `Revoke the share link for ${label}?`;
    const detail = regenerate
      ? 'The current link stops working immediately and you will need to send the new link to your client.'
      : 'The link stops working immediately. You can create a new one later.';
    if (!(await confirm(question, { tone: regenerate ? 'neutral' : 'danger', detail }))) return;
    try {
      const response = await fetch(`/api/${isTask ? 'tasks' : 'invoices'}/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, expected: item.updated_at }),
      });
      await readApiResponse(response);
      toast.success(regenerate
        ? `New share link created for ${label} - send it to your client.`
        : `Share link revoked for ${label}.`);
      await loadAll();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function changeShareLink(kind, item, action) {
    const isTask = kind === 'task';
    const label = isTask ? `"${item.task_title}"` : `invoice ${item.invoice_number}`;
    if (action === 'regenerate_share') {
      const detail = isTask
        ? 'The current link will stop working and a new one will be created. You will need to send the new link to your client.'
        : 'The current link will stop working and a new one will be created. You will need to send the new link to your client.';
      if (!(await confirm(`Regenerate the share link for ${label}?`, { detail }))) return;
    } else {
      if (!(await confirm(`Revoke the share link for ${label}?`, {
        tone: 'danger',
        detail: 'The link will stop working immediately. You can create a new one at any time.',
      }))) return;
    }
    try {
      const response = await fetch(`/api/${isTask ? 'tasks' : 'invoices'}/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, expected: item.updated_at }),
      });
      await readApiResponse(response);
      toast.success(
        action === 'regenerate_share'
          ? `New share link created for ${label}.`
          : `Share link revoked for ${label}.`,
        action === 'regenerate_share'
          ? 'The previous link no longer works - send the new one to your client.'
          : undefined,
      );
      await loadAll();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function saveInvoice(form) {
    const { id, updated_at, ...values } = form;
    const payload = { ...values, items: form.items };
    if (id && updated_at) payload.expected = updated_at;
    const response = await fetch(id ? `/api/invoices/${id}` : '/api/invoices', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await readApiResponse(response);
    setShowInvoiceForm(false);
    setEditingInvoice(null);
    toast.success(id ? 'Invoice updated.' : 'Invoice created.');
    loadAll();
  }

  async function deleteInvoice(id) {
    if (!(await confirm('Delete this invoice?', { detail: 'The invoice moves to trash and can be restored later.' }))) return;
    try {
      const response = await fetch(`/api/invoices/${id}`, { method:'DELETE' });
      await readApiResponse(response);
      toast.success('Invoice moved to trash.');
      loadAll();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function updateInvoiceStatus(id, status) {
    const invoice = invoices.find(item => item.id === id);
    if (!invoice) return;
    let amountPaid;
    if (status === 'partially_paid') {
      const total = Number(invoice.total ?? calcInvoiceTotal(invoice.items, invoice.tax_rate, invoice.discount).total);
      const formatted = `${currencySymbol(invoice.currency)}${money(total)}`;
      const input = await prompt({
        title: 'Record a payment',
        message: 'How much has been paid so far?',
        detail: `The invoice total is ${formatted}.`,
        label: 'Amount paid so far',
        inputMode: 'decimal',
        defaultValue: invoice.amount_paid || '',
        validate: raw => {
          const amount = Number(raw);
          if (!raw.trim()) return 'Enter an amount.';
          if (!Number.isFinite(amount)) return 'Enter a valid number.';
          if (amount <= 0) return 'Enter an amount greater than zero.';
          if (amount >= total) return `Enter an amount less than ${formatted}.`;
          return '';
        },
      });
      if (input === null) return;
      amountPaid = Number(input);
    }
    try {
      const response = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected: invoice.updated_at, payment_status: status, ...(amountPaid === undefined ? {} : { amount_paid: amountPaid }) }),
      });
      await readApiResponse(response);
      toast.success(status === 'partially_paid' ? 'Payment recorded.' : 'Invoice status updated.');
      loadAll();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function loadTrash() {
    setLoadingTrash(true);
    try {
      const optionalInvoices = fetch('/api/invoices?trash=1').then(readApiResponse).catch(error => {
        if (error.status === 403) return [];
        throw error;
      });
      const [t, inv] = await Promise.all([
        fetch('/api/tasks?trash=1').then(readApiResponse),
        optionalInvoices,
      ]);
      setTrashTasks(Array.isArray(t) ? t : []);
      setTrashInvoices(Array.isArray(inv) ? inv : []);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoadingTrash(false);
    }
  }

  async function restoreTask(id) {
    const task = trashTasks.find(item => item.id === id);
    if (!task) { toast.error('That task is no longer in the trash. Refresh to see the current list.'); return; }
    if (!task.updated_at) { toast.error('This task cannot be restored because its last-updated time is missing. Refresh and try again.'); return; }
    if (!(await confirm(`Restore "${task.task_title}"?`, { detail: 'It will move back to your active task list.' }))) return;
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', expected: task.updated_at }),
      });
      await readApiResponse(response);
      toast.success(`"${task.task_title}" restored.`, 'It is back in your active task list.');
      await loadTrash();
      await loadAll();
    } catch (error) {
      toast.error(`Could not restore the task. ${error.message}`);
    }
  }
  async function purgeTask(id) {
    if (!(await confirm('Permanently delete this task?', { tone: 'danger', detail: 'This cannot be undone. The task and its history will be removed for good.' }))) return;
    try {
      const response = await fetch(`/api/tasks/${id}?permanent=1`, { method: 'DELETE' });
      await readApiResponse(response);
      toast.success('Task permanently deleted.');
      loadTrash();
    } catch (error) {
      toast.error(error.message);
    }
  }
  async function restoreInvoice(id) {
    const invoice = trashInvoices.find(item => item.id === id);
    if (!invoice) { toast.error('That invoice is no longer in the trash. Refresh to see the current list.'); return; }
    if (!invoice.updated_at) { toast.error('This invoice cannot be restored because its last-updated time is missing. Refresh and try again.'); return; }
    if (!(await confirm(`Restore invoice ${invoice.invoice_number}?`, { detail: 'It will move back to your active invoice list.' }))) return;
    try {
      const response = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', expected: invoice.updated_at }),
      });
      await readApiResponse(response);
      toast.success(`Invoice ${invoice.invoice_number} restored.`, 'It is back in your active invoice list.');
      await loadTrash();
      await loadAll();
    } catch (error) {
      toast.error(`Could not restore the invoice. ${error.message}`);
    }
  }
  async function purgeInvoice(id) {
    if (!(await confirm('Permanently delete this invoice?', { tone: 'danger', detail: 'This cannot be undone. The invoice, its items, and its payment history will be removed for good.' }))) return;
    try {
      const response = await fetch(`/api/invoices/${id}?permanent=1`, { method: 'DELETE' });
      await readApiResponse(response);
      toast.success('Invoice permanently deleted.');
      loadTrash();
    } catch (error) {
      toast.error(error.message);
    }
  }

  // ── Activity feed ──────────────────────────────────────────────────
  async function loadActivity() {
    setLoadingActivity(true);
    try {
      const response = await fetch('/api/activity');
      const data = await readApiResponse(response);
      setActivityItems(Array.isArray(data) ? data : []);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoadingActivity(false);
    }
  }
  function openTaskFromActivity(id) {
    const t = tasks.find(x => x.id === id);
    if (!t) { toast.error('This task is no longer visible — it may have been moved to trash.'); return; }
    setTab('list'); openEditForm(t);
  }
  function openInvoiceFromActivity(id) {
    const inv = invoices.find(x => x.id === id);
    if (!inv) { toast.error('This invoice is no longer visible — it may have been moved to trash.'); return; }
    setTab('invoices'); setEditingInvoice(inv); setShowInvoiceForm(true);
  }

  async function copyInvoiceLink(invoice) {
    await copy(`${origin}/invoice/${invoice.share_token}`);
  }

  // ── Booking requests ───────────────────────────────────────────────
  // Requests arrive from the public availability page. Confirming one is a
  // commercial decision, so the whole tab is behind manage_booking_requests.
  async function loadRequests() {
    setLoadingRequests(true);
    try {
      const data = await readApiResponse(await fetch('/api/booking-requests'));
      setRequests(Array.isArray(data?.requests) ? data.requests : []);
      setRequestsError('');
    } catch (error) {
      setRequestsError(error.message);
    } finally {
      setLoadingRequests(false);
    }
  }

  async function decideRequest(id, status) {
    const verb = { confirmed: 'Confirm', declined: 'Decline', new: 'Reopen' }[status] || 'Update';
    const extra = status === 'confirmed'
      ? { detail: 'The slot is treated as spoken for. Tell the client directly to finalise it.' }
      : status === 'declined'
      ? { detail: 'The client is not notified automatically. Follow up with them yourself.' }
      : { detail: 'This puts the request back in the new queue.' };
    if (!(await confirm(`${verb} this booking request?`, extra))) return;
    try {
      await readApiResponse(await fetch(`/api/booking-requests/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }));
      toast.success(`Booking request ${status}.`);
      await loadRequests();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function archiveRequest(id) {
    if (!(await confirm('Remove this booking request from the list?', { detail: 'The record is kept, just hidden. It can be brought back by clearing the filter in the API.' }))) return;
    try {
      await readApiResponse(await fetch(`/api/booking-requests/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'declined', archived: true }),
      }));
      toast.success('Booking request removed.');
      await loadRequests();
    } catch (error) {
      toast.error(error.message);
    }
  }

  // ── Client portal link ────────────────────────────────────────────
  async function copyClientPortalLink(clientName, clientEmail) {
    let token;
    try {
      const res = await fetch('/api/client-portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: clientName, client_email: clientEmail || '' }),
      });
      if (!res.ok) { const d = await res.json().catch(()=>({})); toast.error(d.error || 'Could not create client link.'); return; }
      ({ token } = await res.json());
    } catch {
      toast.error('Could not create client link.');
      return;
    }
    const link = `${origin}/client-portal/${token}`;
    const copied = await copy(link, { success: `Client link created and copied for ${clientName}.` });
    if (copied) {
      setPortalCopied(clientName);
      setTimeout(() => setPortalCopied(null), 1800);
    } else {
      toast.error('The link was created but could not be copied.', { detail: link });
    }
  }

  // Primary navigation. "Tasks" is the default list view; the board and
  // calendar are sibling views of the same data rather than separate pages.
  const primaryNav = [
    { key: 'list', label: 'Tasks', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
    { key: 'board', label: 'Board', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="18" rx="1.5"/><rect x="14" y="3" width="7" height="11" rx="1.5"/></svg> },
    { key: 'activity', label: 'History', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
    { key: 'calendar', label: 'Calendar', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
  ];

  // Secondary items render under their own "Workspace" heading.
  const workspaceNav = [];
  if (isSuperAdmin || perms?.perm_view_client_links) {
    workspaceNav.push({ key: 'clients', label: 'Clients', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> });
  }
  if (isSuperAdmin || perms.perm_view_invoices || perms.perm_manage_invoices) {
    workspaceNav.push({ key: 'invoices', label: 'Invoices', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg> });
  }
  if (isSuperAdmin || perms.perm_delete_tasks || perms.perm_manage_invoices) {
    workspaceNav.push({ key: 'trash', label: 'Trash', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg> });
  }
  // Booking requests are a commercial queue, so they sit behind their own
  // permission rather than manage_availability which staff hold.
  if (isSuperAdmin || perms.perm_manage_booking_requests) {
    workspaceNav.push({ key: 'requests', label: 'Requests', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 16l2 2 4-4"/></svg> });
  }

  // Settings is a real route, not a tab, so it is flagged as a link and the
  // Sidebar renders it with a router navigation instead of setTab.
  workspaceNav.push({
    key: 'settings',
    label: 'Settings',
    href: '/settings',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  });

  const navGroups = [
    { label: '', items: primaryNav },
    { label: 'Workspace', items: workspaceNav },
  ].filter(group => group.items.length > 0);
  // Flat list for callers that only need the keys (keyboard shortcuts).
  const navItems = navGroups.flatMap(group => group.items);

  // ── Navigation ──────────────────────────────────────────────────────
  // Single entry point for switching views. Sidebar items and the in-page
  // shortcuts both route through here so lazy views stay consistent.
  const goToTab = key => {
    setTab(key);
    if (key === 'trash') loadTrash();
    if (key === 'activity') loadActivity();
    if (key === 'requests') loadRequests();
  };

  // 'n' starts a new task and 1/2/3 switch views, but only when the user
  // is not already typing into a field.
  useEffect(() => {
    const onKey = e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod) return;
      const target = e.target;
      const typing = target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (typing) return;
      if (e.key.toLowerCase() === 'n' && (isSuperAdmin || perms.perm_add_tasks)) { e.preventDefault(); openNewForm(); }
      const jump = { 1: 'list', 2: 'board', 3: 'calendar' }[e.key];
      if (jump) { e.preventDefault(); goToTab(jump); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, perms]);

  return (
    <div className="app-shell">
      <Sidebar
        items={navItems}
        groups={navGroups}
        activeKey={tab}
        onSelect={goToTab}
        displayName={displayName}
        dark={dark}
        onToggleDark={toggleDark}
        onSignOut={handleLogout}
        extraLink={isSuperAdmin ? { label: '⭐ Admin', onClick: () => router.push('/admin') } : null}
      />

      <div className="app-main">
      <div className="container app">
        {loadError && <div className="alert error-alert" role="alert">{loadError}</div>}
        {loading ? (
          <DashboardSkeleton />
        ) : (
          <>
            <DashboardHeader
              displayName={displayName}
              canAdd={isSuperAdmin || !!perms.perm_add_tasks}
              onAdd={openNewForm}
              tab={tab}
            />
            {tab==='list' && (
              <ListView tasks={tasks} invoices={invoices} team={team} categories={categories}
                onAdd={openNewForm} onEdit={openEditForm} onDelete={deleteTask} onCopy={copyLink} onShareChange={changeShareLink} copied={copied}
                 isSuperAdmin={isSuperAdmin} userId={userId} perms={perms}
                 onBulkStatusChange={bulkUpdateStatus} onBulkTrash={bulkTrash} />
            )}
            {tab==='board' && (
              <BoardView tasks={tasks} onMove={moveTaskToStatus} onEdit={openEditForm}
                canDrag={isSuperAdmin || !!perms.perm_edit_tasks || !!perms.perm_edit_own_tasks}
                onAdd={(isSuperAdmin || perms.perm_add_tasks) ? openNewForm : null} />
            )}
            {tab==='activity' && (
              <ActivityView items={activityItems} loading={loadingActivity}
                onOpenTask={openTaskFromActivity} onOpenInvoice={openInvoiceFromActivity} />
            )}
            {tab==='requests' && (
              <RequestsView requests={requests} loading={loadingRequests} error={requestsError}
                onDecide={decideRequest} onArchive={archiveRequest} />
            )}
            {tab==='calendar' && (
              <CalendarView tasks={tasks} monthOffset={monthOffset} setMonthOffset={setMonthOffset} onAdd={openNewForm} onEdit={openEditForm} canAdd={isSuperAdmin || perms.perm_add_tasks} />
            )}
            {tab==='clients' && (
              <ClientsView tasks={tasks} onCopyPortal={copyClientPortalLink} copiedClient={portalCopied} />
            )}
            {tab==='invoices' && (
              <InvoiceList
                invoices={invoices}
                origin={origin}
                userId={userId}
                canCreate={isSuperAdmin || perms.perm_create_invoices || perms.perm_manage_invoices}
                canEdit={isSuperAdmin || perms.perm_edit_invoices || perms.perm_edit_own_invoices || perms.perm_manage_invoices}
                canEditOwn={isSuperAdmin || perms.perm_edit_own_invoices}
                canManage={isSuperAdmin || perms.perm_manage_invoices}
                canDelete={isSuperAdmin || perms.perm_manage_invoices}
                canRecordPayments={isSuperAdmin || perms.perm_record_payments}
                onAdd={()=>{setEditingInvoice(null);setShowInvoiceForm(true);}}
                onEdit={(inv)=>{setEditingInvoice(inv);setShowInvoiceForm(true);}}
                onDelete={deleteInvoice}
                onStatusChange={updateInvoiceStatus}
                onCopyInvoice={copyInvoiceLink}
                onShareChange={changeShareLink}
              />
            )}
            {tab==='trash' && (
              <TrashView
                tasks={trashTasks} invoices={trashInvoices} loading={loadingTrash}
                isSuperAdmin={isSuperAdmin}
                 showTasks={isSuperAdmin || perms.perm_delete_tasks}
                 showInvoices={isSuperAdmin || perms.perm_manage_invoices}
                onRestoreTask={restoreTask} onPurgeTask={purgeTask}
                onRestoreInvoice={restoreInvoice} onPurgeInvoice={purgeInvoice}
              />
            )}
          </>
        )}

        {showForm && (
          <TaskForm key={editing?.id || 'new'} editing={editing} team={team} categories={categories}
            clientNames={[...new Set([...tasks.map(t=>t.client_name), ...invoices.map(i=>i.client_name)].filter(Boolean))].sort()}
            onChange={setEditing}
            onSave={saveTask} onCancel={()=>{setShowForm(false);setEditing(null);}} />
        )}
        {showInvoiceForm && (
          <InvoiceForm key={editingInvoice?.id || 'new'} invoice={editingInvoice} invoices={invoices}
            clientNames={[...new Set([...tasks.map(t=>t.client_name), ...invoices.map(i=>i.client_name)].filter(Boolean))].sort()}
            onSave={saveInvoice} onCancel={()=>{setShowInvoiceForm(false);setEditingInvoice(null);}} />
        )}
      </div>
      </div>
    </div>
  );
}

// ── List view ───────────────────────────────────────────────────────
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const [y,m,d] = dateStr.slice(0,10).split('-').map(Number);
  const due = new Date(y, m-1, d);
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((due - today) / 86400000);
}

function DueBadge({ dueDate, status }) {
  if (status === 'done') return null;
  const diff = daysUntil(dueDate);
  if (diff === null) return null;
  if (diff < 0) return (
    <span className="badge sm red">
      Overdue {Math.abs(diff)}d
    </span>
  );
  if (diff <= 3) return (
    <span className="badge sm amber">
      Due {diff===0?'today':diff===1?'tomorrow':`in ${diff}d`}
    </span>
  );
  return null;
}

function PriorityBadge({ priority }) {
  const normalized = priority === 'normal' ? 'medium' : priority;
  if (!normalized || normalized === 'medium') return null;
  const isUrgent = normalized === 'urgent';
  const isHigh = normalized === 'high';
  return (
    <span className={`badge sm ${isUrgent ? 'red' : 'amber'}`}>
      {isUrgent ? 'Urgent' : isHigh ? 'High' : 'Low'}
    </span>
  );
}

// Matches the board column dots so list and board read as one system.
function StatusPill({ status }) {
  if (!status) return null;
  return (
    <span className="status-pill">
      <span className="board-dot" data-status={status} aria-hidden="true" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

const PRIORITY_WEIGHT = { urgent: 0, high: 1, medium: 2, normal: 2, low: 3 };

const DUE_FILTERS = {
  all:      { label: 'Any due date',  test: () => true },
  overdue:  { label: 'Overdue',       test: (d) => d !== null && d < 0 },
  week:     { label: 'Due this week', test: (d) => d !== null && d >= 0 && d <= 7 },
  none:     { label: 'No due date',   test: (d) => d === null },
};

function ListView({ tasks, invoices, team, categories, onAdd, onEdit, onDelete, onCopy, onShareChange, copied, isSuperAdmin, userId, perms, onBulkStatusChange, onBulkTrash }) {
  // Resets the filters and returns to the list view. Passed to the side
  // panel's "Review all tasks" action.
  const onShowAll = () => {
    setFilterStatus('all'); setFilterAssignee('all'); setFilterCategory('all'); setFilterDue('all');
  };
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterDue, setFilterDue] = useState('all');
  const [selected, setSelected] = useState(() => new Set());
  const canAdd    = isSuperAdmin || !!perms.perm_add_tasks;
  const canEdit   = isSuperAdmin || !!perms.perm_edit_tasks || !!perms.perm_edit_own_tasks;
  const canDelete = isSuperAdmin || !!perms.perm_delete_tasks;
  const canCopy   = isSuperAdmin || !!perms.perm_view_client_links;
  const myMemberId = team.find(member => String(member.user_id) === String(userId))?.id;
  const canBulk   = canEdit || canDelete;
  const canEditTask = task => isSuperAdmin || !!perms.perm_edit_tasks || (!!perms.perm_edit_own_tasks
    && (task.assignee_ids || (task.assigned_to ? [task.assigned_to] : [])).map(String).includes(String(myMemberId)));
  const active = tasks.filter(t => t.status !== 'done');
  const done   = tasks.filter(t => t.status === 'done');

  const q = search.trim().toLowerCase();
  const visibleTasks = tasks
    .filter(t => !q || t.client_name?.toLowerCase().includes(q) || t.task_title?.toLowerCase().includes(q))
    .filter(t => filterStatus === 'all' || t.status === filterStatus)
    .filter(t => filterAssignee === 'all' || (filterAssignee === 'unassigned'
      ? !(t.assignee_ids || (t.assigned_to ? [t.assigned_to] : [])).length
      : (t.assignee_ids || (t.assigned_to ? [t.assigned_to] : [])).map(String).includes(String(filterAssignee))))
    .filter(t => filterCategory === 'all' || (filterCategory === 'none' ? !t.category_id : String(t.category_id) === filterCategory))
    .filter(t => DUE_FILTERS[filterDue].test(daysUntil(t.due_date)))
    .slice()
    .sort((a,b) => (PRIORITY_WEIGHT[a.priority]??2) - (PRIORITY_WEIGHT[b.priority]??2));

  const filtersActive = filterStatus!=='all' || filterAssignee!=='all' || filterCategory!=='all' || filterDue!=='all';
  const visibleIds = visibleTasks.map(t => t.id);
  const selectedIds = visibleIds.filter(id => selected.has(id));
  const allVisibleSelected = visibleIds.length > 0 && selectedIds.length === visibleIds.length;

  function toggleOne(id) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleAllVisible() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  }
  function clearSelection() { setSelected(new Set()); }

  const dueThisWeek = active.filter(t => { const d = daysUntil(t.due_date); return d !== null && d >= 0 && d <= 7; }).length;
  const overdueCount = active.filter(t => { const d = daysUntil(t.due_date); return d !== null && d < 0; }).length;
  const unpaidInvoices = (invoices||[]).filter(i => (i.payment_status||'unpaid') === 'unpaid').length;

  // Upcoming = not done, with a due date, soonest first. Drives both the
  // summary card and the "next task" callout in the side panel.
  const upcoming = active
    .filter(t => daysUntil(t.due_date) !== null)
    .slice()
    .sort((a,b) => (daysUntil(a.due_date) ?? 1e9) - (daysUntil(b.due_date) ?? 1e9));

  return (
    <>
      <div className="stat-grid">
        <StatCard label="Total Tasks" value={tasks.length} hint={`${active.length} in progress`} tone="blue" />
        <StatCard label="Active" value={active.length} hint={`${done.length} completed`} tone="blue" />
        <StatCard label="Due this week" value={dueThisWeek} hint="Next 7 days" tone="amber" />
        <StatCard
          label="Overdue"
          value={overdueCount}
          hint={overdueCount > 0 ? 'Needs attention' : 'All on track'}
          tone={overdueCount > 0 ? 'red' : 'green'}
        />
      </div>

      <div className="dash-columns">
      <div className="dash-main">
      <div className="card">
      <div className="nav-row">
        <div>
          <strong>All tasks</strong>
          <span className="muted" style={{fontSize:13, marginLeft:8}}>{active.length} active · {done.length} done</span>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="secondary" onClick={()=>exportTasksCsv(tasks)}>Export CSV</button>
          {canAdd && <button onClick={onAdd}>+ Add task</button>}
        </div>
      </div>

      <input
        placeholder="Search by client or task title…"
        value={search}
        onChange={e=>setSearch(e.target.value)}
        style={{margin:'12px 0'}}
      />

      {/* Filters */}
      <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:12}}>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{margin:0, width:'auto', flex:'1 1 140px'}}>
          <option value="all">Any status</option>
          {Object.entries(STATUS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterAssignee} onChange={e=>setFilterAssignee(e.target.value)} style={{margin:0, width:'auto', flex:'1 1 140px'}}>
          <option value="all">Anyone assigned</option>
          <option value="unassigned">Unassigned</option>
          {(team||[]).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={filterCategory} onChange={e=>setFilterCategory(e.target.value)} style={{margin:0, width:'auto', flex:'1 1 140px'}}>
          <option value="all">Any category</option>
          <option value="none">No category</option>
          {(categories||[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterDue} onChange={e=>setFilterDue(e.target.value)} style={{margin:0, width:'auto', flex:'1 1 140px'}}>
          {Object.entries(DUE_FILTERS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {filtersActive && (
          <button className="secondary" style={{flex:'0 0 auto'}}
            onClick={()=>{setFilterStatus('all');setFilterAssignee('all');setFilterCategory('all');setFilterDue('all');}}>
            Clear filters
          </button>
        )}
      </div>

      {/* Bulk actions toolbar */}
      {canBulk && visibleTasks.length > 0 && (
        <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', padding:'8px 10px', borderRadius:8, background:'var(--accent-soft)', marginBottom:12}}>
          <label style={{display:'flex', alignItems:'center', gap:6, fontSize:13, margin:0, cursor:'pointer'}}>
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} style={{margin:0, width:'auto'}} />
            Select all ({visibleTasks.length})
          </label>
          {selectedIds.length > 0 && (
            <>
              <span className="muted" style={{fontSize:13}}>{selectedIds.length} selected</span>
              {canEdit && (
                <select defaultValue="" style={{margin:0, width:'auto', fontSize:13, padding:'5px 8px'}}
                  onChange={e => { if (e.target.value) { onBulkStatusChange(selectedIds, e.target.value); e.target.value=''; } }}>
                  <option value="" disabled>Set status to…</option>
                  {Object.entries(STATUS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              )}
              {canDelete && (
                <button className="danger" style={{fontSize:13, padding:'5px 10px'}} onClick={()=>onBulkTrash(selectedIds)}>
                  Move to trash
                </button>
              )}
              <button className="secondary" style={{fontSize:13, padding:'5px 10px'}} onClick={clearSelection}>Clear</button>
            </>
          )}
        </div>
      )}

      {tasks.length === 0 && <p className="muted">No tasks yet.{canAdd ? ' Add one to get started.' : ''}</p>}
      {tasks.length > 0 && visibleTasks.length === 0 && <p className="muted">No tasks match the current search and filters.</p>}
      {visibleTasks.map((t) => {
        const canDelThis = canDelete && (t.status !== 'done' || isSuperAdmin);
        return (
          <div className="task-row" key={t.id}>
            {canBulk && (
              <input type="checkbox" checked={selected.has(t.id)} onChange={()=>toggleOne(t.id)}
                style={{margin:'2px 10px 0 0', width:'auto', flexShrink:0}} />
            )}
            <div style={{flex:1, minWidth:0}}>
              <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <strong style={{fontSize:15}}>{t.task_title}</strong>
                <StatusPill status={t.status} />
                {t.category_name && (
                  <span style={{fontSize:11,padding:'2px 8px',borderRadius:10,background:t.category_color||'#ccc',color:'#fff',fontWeight:600}}>
                    {t.category_name}
                  </span>
                )}
                <DueBadge dueDate={t.due_date} status={t.status} />
                <PriorityBadge priority={t.priority} />
              </div>
              <p className="muted" style={{margin:'4px 0 0', fontSize:13}}>
                {t.client_name} · {fmt(t.start_date)} → {fmt(t.due_date)}
                {assigneeLabel(t) ? ` · ${assigneeLabel(t)}` : ''}
                {t.payment_status && t.payment_status !== 'unpaid' && (
                  <span className={`badge sm ${t.payment_status === 'paid' ? 'green' : 'amber'}`}>
                    {TASK_PAYMENT_LABELS[t.payment_status] || t.payment_status}
                  </span>
                )}
                {(!t.payment_status || t.payment_status==='unpaid') && (
                  <span className="badge sm red">Unpaid</span>
                )}
              </p>
              {canCopy && t.client_visible && (
                <div className="share-link" style={{marginTop:8, maxWidth:400, flexWrap:'wrap'}}>
                  {t.share_token ? (
                    <>
                      <span style={{flex:1, minWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        /client/{t.share_token}
                      </span>
                      <button className="secondary" style={{padding:'4px 10px', whiteSpace:'nowrap'}}
                        onClick={() => onCopy(t.share_token)}>
                        {copied === t.share_token ? '✓ Copied' : 'Copy link'}
                      </button>
                      <button className="secondary" style={{padding:'4px 10px', whiteSpace:'nowrap'}}
                        onClick={() => onShareChange('task', t, 'regenerate_share')}>
                        New link
                      </button>
                      <button className="secondary" style={{padding:'4px 10px', whiteSpace:'nowrap'}}
                        title="Stop this link working immediately"
                        onClick={() => onShareChange('task', t, 'revoke_share')}>
                        Revoke
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="muted" style={{flex:1, fontSize:13}}>
                        No active share link - this task is not reachable by clients.
                      </span>
                      <button className="secondary" style={{padding:'4px 10px', whiteSpace:'nowrap'}}
                        onClick={() => onShareChange('task', t, 'regenerate_share')}>
                        Create link
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            <div style={{display:'flex', gap:8, flexShrink:0}}>
              {canEditTask(t) && <button className="secondary" onClick={() => onEdit(t)}>Edit</button>}
              {canDelThis
                ? <button className="danger" onClick={() => onDelete(t.id, t.status)}>Delete</button>
                : canDelete && t.status === 'done'
                  ? <button className="danger" style={{opacity:0.35,cursor:'not-allowed'}} title="Only super admin can delete completed tasks">Delete</button>
                  : null
              }
            </div>
          </div>
        );
      })}
    </div>

      {/* Upcoming tasks. Summary only — the full list, filters and bulk
          actions stay above, so this never duplicates controls. */}
      <div className="card">
        <div className="card-head">
          <strong>Upcoming Tasks</strong>
          <span className="muted" style={{fontSize:13}}>
            {upcoming.length ? `Next ${Math.min(5, upcoming.length)} by due date` : 'Nothing scheduled'}
          </span>
        </div>
        {upcoming.length === 0 ? (
          <p className="muted" style={{margin:0, fontSize:14}}>
            No tasks with a due date. Add one to see it here.
          </p>
        ) : (
          <div className="upcoming-list">
            {upcoming.slice(0, 5).map(t => (
              <button key={t.id} className="upcoming-row" onClick={() => onEdit(t)}>
                <span className="upcoming-name">{t.task_title}</span>
                <span className="muted upcoming-client">{t.client_name || 'No client'}</span>
                <span className="upcoming-when">
                  {fmt(t.due_date)}
                  <DueBadge dueDate={t.due_date} status={t.status} />
                </span>
                <StatusPill status={t.status} />
              </button>
            ))}
          </div>
        )}
      </div>
      </div>

      <aside className="dash-side">
        <div className="card">
          <div className="card-head">
            <strong>Schedule Overview</strong>
          </div>
          <dl className="overview-list">
            <div className="overview-row">
              <dt>Active tasks</dt>
              <dd>{active.length}</dd>
            </div>
            <div className="overview-row">
              <dt>Due this week</dt>
              <dd>{dueThisWeek}</dd>
            </div>
            <div className="overview-row">
              <dt>Overdue</dt>
              <dd style={overdueCount > 0 ? { color: 'var(--red-fg)' } : undefined}>{overdueCount}</dd>
            </div>
            <div className="overview-row">
              <dt>Unpaid invoices</dt>
              <dd style={unpaidInvoices > 0 ? { color: 'var(--amber-fg)' } : undefined}>{unpaidInvoices}</dd>
            </div>
          </dl>

          {upcoming[0] && (
            <div className="overview-next">
              <span className="muted">Next task</span>
              <strong>{upcoming[0].task_title}</strong>
              <span className="muted">{fmt(upcoming[0].due_date)}</span>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><strong>Quick Actions</strong></div>
          <div className="quick-actions">
            {onAdd && (
              <button className="primary" onClick={onAdd} style={{width:'100%'}}>Create Task</button>
            )}
            <button className="secondary" onClick={onShowAll} style={{ width: '100%' }}>
              Review all tasks
            </button>
          </div>
        </div>
      </aside>
      </div>
    </>
  );
}

function StatCard({ label, value, hint, tone = 'blue' }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

// ── Dashboard header ─────────────────────────────────────────────────
// Greeting, subtitle and the primary action. Kept out of the individual
// views so the header stays put when switching tabs.
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const TAB_TITLES = {
  list: 'Manage and schedule your tasks from one place.',
  board: 'Drag tasks between columns to update their status.',
  calendar: 'See everything scheduled, by day.',
  activity: 'A running log of everything that has happened.',
  clients: 'Share read-only portals with your clients.',
  invoices: 'Track invoice status and payments.',
  trash: 'Restore or permanently remove deleted items.',
};

function DashboardHeader({ displayName, canAdd, onAdd, tab }) {
  return (
    <header className="dash-header">
      <div className="dash-header-text">
        <h1 className="dash-greeting">{greeting()}, {displayName}</h1>
        <p className="dash-subtitle">{TAB_TITLES[tab] || TAB_TITLES.list}</p>
      </div>
      {canAdd && (
        <button className="primary" onClick={onAdd}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create Task
        </button>
      )}
    </header>
  );
}

// ── Board view ───────────────────────────────────────────────────────
// Column order defines the board layout and the drag targets.
const BOARD_COLUMNS = ['not_started', 'in_progress', 'review', 'done'];

function BoardCard({ task, onMove, onEdit, canDrag, dragging, onDragStart, onDragEnd }) {
  const due = daysUntil(task.due_date);
  const overdue = task.status !== 'done' && due !== null && due < 0;
  const assignee = assigneeLabel(task);

  return (
    <article
      className={`board-card${dragging ? ' dragging' : ''}`}
      draggable={canDrag}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      tabIndex={0}
      role="button"
      aria-label={`${task.task_title}, ${STATUS_LABELS[task.status]}. Press enter to edit.`}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(task); }
      }}
      onClick={() => onEdit(task)}
    >
      <div className="board-card-top">
        <span className="board-card-title">{task.task_title}</span>
        {task.priority === 'high' && <span className="board-flag" title="High priority">!</span>}
      </div>

      <div className="board-card-meta">
        {task.client_name && <span className="board-chip">{task.client_name}</span>}
        {assignee && <span className="board-chip assignee" title={`Assigned to ${assignee}`}>{assignee}</span>}
      </div>

      <div className="board-card-foot">
        {task.due_date && (
          <span className={`board-due${overdue ? ' overdue' : ''}`}>
            {overdue ? `${Math.abs(due)}d late` : due === 0 ? 'Due today' : due === 1 ? 'Due tomorrow' : fmt(task.due_date)}
          </span>
        )}
        {task.status !== 'done' && Number(task.progress) > 0 && (
          <span className="board-progress" title={`${task.progress}% complete`}>
            <span className="board-progress-fill" style={{ width: `${Math.min(100, Number(task.progress))}%` }} />
          </span>
        )}
        {task.status === 'done' && <span className="board-done-tick" aria-label="Complete">✓</span>}
      </div>
    </article>
  );
}

function BoardView({ tasks, onMove, onEdit, canDrag, onAdd }) {
  const [dragId, setDragId] = useState(null);
  const [overColumn, setOverColumn] = useState(null);
  const columns = useMemo(() => {
    const map = {};
    for (const key of BOARD_COLUMNS) map[key] = [];
    for (const task of tasks) (map[task.status] || map.not_started).push(task);
    return map;
  }, [tasks]);

  const dragging = dragId ? tasks.find(t => t.id === dragId) : null;

  function drop(status) {
    if (dragging) onMove(dragging, status);
    setDragId(null);
    setOverColumn(null);
  }

  if (!tasks.length) {
    return (
      <div className="card board-empty">
        <strong style={{ fontSize: 16 }}>Nothing on the board yet</strong>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>Create a task and it will appear here.</p>
        {onAdd && <button className="primary" style={{ marginTop: 14 }} onClick={onAdd}>New task</button>}
      </div>
    );
  }

  return (
    <div className="board" role="list" aria-label="Task board">
      {BOARD_COLUMNS.map(status => {
        const items = columns[status];
        const isOver = overColumn === status;
        return (
          <section
            key={status}
            className={`board-col${isOver && dragId ? ' over' : ''}`}
            aria-label={STATUS_LABELS[status]}
            onDragOver={e => { if (!dragId) return; e.preventDefault(); setOverColumn(status); }}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget)) setOverColumn(c => (c === status ? null : c));
            }}
            onDrop={e => { e.preventDefault(); drop(status); }}
          >
            <header className="board-col-head">
              <span className="board-dot" data-status={status} aria-hidden="true" />
              <span className="board-col-title">{STATUS_LABELS[status]}</span>
              <span className="board-count">{items.length}</span>
            </header>

            <div className="board-col-body">
              {items.length === 0 && <p className="board-col-empty">Drop here</p>}
              {items.map(task => (
                <BoardCard
                  key={task.id}
                  task={task}
                  canDrag={canDrag}
                  dragging={dragId === task.id}
                  onDragStart={e => {
                    setDragId(task.id);
                    e.dataTransfer.effectAllowed = 'move';
                    // Firefox refuses to start a drag without payload.
                    try { e.dataTransfer.setData('text/plain', String(task.id)); } catch { /* ignore */ }
                  }}
                  onDragEnd={() => { setDragId(null); setOverColumn(null); }}
                  onMove={onMove}
                  onEdit={onEdit}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ── Booking requests view ────────────────────────────────────────────
const REQUEST_STATUS_META = {
  new:      { label: 'New',      cls: 'badge amber' },
  confirmed:{ label: 'Confirmed',cls: 'badge green' },
  declined: { label: 'Declined', cls: 'badge red'   },
};

function fmtDay(value) {
  if (!value) return '';
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function RequestsView({ requests, loading, error, onDecide, onArchive }) {
  if (error) {
    return (
      <div className="card">
        <p className="alert error-alert" role="alert">{error}</p>
      </div>
    );
  }
  const open = requests.filter(r => r.status === 'new');
  const settled = requests.filter(r => r.status !== 'new');

  function card(request) {
    const meta = REQUEST_STATUS_META[request.status] || REQUEST_STATUS_META.new;
    return (
      <div key={request.id} className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15 }}>{request.name}</strong>
            <span className={`${meta.cls} sm`} style={{ marginLeft: 8 }}>{meta.label}</span>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {fmtDay(request.requested_date)}
              {request.service ? ` · ${request.service}` : ''}
              {request.company ? ` · ${request.company}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {request.status !== 'confirmed' && (
              <button type="button" onClick={() => onDecide(request.id, 'confirmed')}>Confirm</button>
            )}
            {request.status !== 'declined' && (
              <button type="button" className="secondary" onClick={() => onDecide(request.id, 'declined')}>Decline</button>
            )}
            {request.status !== 'new' && (
              <button type="button" className="secondary" onClick={() => onDecide(request.id, 'new')}>Reopen</button>
            )}
            <button type="button" className="secondary" onClick={() => onArchive(request.id)} aria-label={`Remove request from ${request.name}`}>Remove</button>
          </div>
        </div>

        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          {request.email && <div>{request.email}</div>}
          {request.phone && <div>{request.phone}</div>}
        </div>
        {request.message && (
          <p style={{ margin: '10px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>{request.message}</p>
        )}
        {request.handled_by && (
          <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
            {request.status === 'new' ? 'Reopened' : 'Decided'} by {request.handled_by}
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card">
        <strong style={{ fontSize: 17 }}>Booking requests</strong>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          Date requests sent from the public availability page. Confirming one holds the slot; the client is
          not emailed automatically, so follow up with them.
        </p>
      </div>

      {loading && requests.length === 0 && <RowSkeleton count={3} />}

      {!loading && requests.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            No booking requests yet. They appear here as soon as someone requests a date on the availability page.
          </p>
        </div>
      )}

      {open.length > 0 && (
        <>
          <h3 style={{ margin: '4px 0 0', fontSize: 14 }}>
            Waiting on you <span className="muted">({open.length})</span>
          </h3>
          {open.map(card)}
        </>
      )}

      {settled.length > 0 && (
        <>
          <h3 style={{ margin: '8px 0 0', fontSize: 14 }}>Decided ({settled.length})</h3>
          {settled.map(card)}
        </>
      )}
    </div>
  );
}

// ── Activity view ───────────────────────────────────────────────────
function ActivityView({ items, loading, onOpenTask, onOpenInvoice }) {
  return (
    <div className="card">
      <strong style={{fontSize:17}}>Recent activity</strong>
      <p className="muted" style={{fontSize:13, marginTop:4}}>
        Everything that changed on the tasks and invoices you can see, newest first. Tap an entry to open it.
      </p>

      {loading && <RowSkeleton count={5} />}
      {!loading && items.length === 0 && <p className="muted" style={{marginTop:16}}>No activity recorded yet.</p>}

      {!loading && items.map(item => (
        <div key={item.id} className="task-row" style={{cursor:'pointer'}}
          onClick={() => item.type === 'task' ? onOpenTask(item.refId) : onOpenInvoice(item.refId)}>
          <div style={{minWidth:0, flex:1}}>
            <div style={{fontSize:14}}>{item.message}</div>
            <div className="muted" style={{fontSize:12, marginTop:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
              {item.type === 'task' ? `Task · ${item.title}` : `Invoice ${item.title}`} · {item.client_name}
              {item.actor ? ` · ${item.actor}` : ''} · {new Date(item.created_at).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Clients view ────────────────────────────────────────────────────
function ClientsView({ tasks, onCopyPortal, copiedClient }) {
  const map = new Map();
  for (const t of tasks) {
    if (!t.client_name) continue;
    if (!map.has(t.client_name)) map.set(t.client_name, { name: t.client_name, email: '', active: 0, done: 0 });
    const c = map.get(t.client_name);
    if (!c.email && t.client_email) c.email = t.client_email;
    if (t.status === 'done') c.done++; else c.active++;
  }
  const clients = [...map.values()].sort((a,b) => a.name.localeCompare(b.name));

  return (
    <div className="card">
      <strong style={{fontSize:17}}>Clients</strong>
      <p className="muted" style={{fontSize:13, marginTop:4}}>
        One link per client showing all of their active and completed tasks — share this instead of a separate link per task.
      </p>

      {clients.length === 0 && <p className="muted" style={{marginTop:16}}>No clients yet.</p>}
      {clients.map(c => (
        <div className="task-row" key={c.name}>
          <div style={{minWidth:0, flex:1}}>
            <div style={{fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{c.name}</div>
            <div className="muted" style={{fontSize:12}}>{c.active} active · {c.done} done{c.email ? ` · ${c.email}` : ''}</div>
          </div>
          <button className="secondary" style={{flexShrink:0}} onClick={() => onCopyPortal(c.name, c.email)}>
            {copiedClient === c.name ? '✓ Copied' : 'Copy client link'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Skeleton loaders ────────────────────────────────────────────────
function Skeleton({ width='100%', height=14, radius=6, style }) {
  return <div className="skeleton" style={{ width, height, borderRadius:radius, ...style }} />;
}

function StatCardsSkeleton({ count=4 }) {
  return (
    <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16}}>
      {Array.from({length:count}).map((_,i)=>(
        <div key={i} style={{flex:'1 1 120px',background:'var(--accent-soft)',borderRadius:10,padding:'10px 14px'}}>
          <Skeleton width={36} height={20} style={{marginBottom:8}} />
          <Skeleton width={72} height={10} />
        </div>
      ))}
    </div>
  );
}

// Generic row skeleton, shaped like a .task-row entry — used for the task
// list, activity feed, and trash lists while each fetches.
function RowSkeleton({ count=4, withBadge=false }) {
  return (
    <>
      {Array.from({length:count}).map((_,i)=>(
        <div className="task-row" key={i}>
          <div style={{flex:1, minWidth:0}}>
            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
              <Skeleton width={`${45 + (i%3)*10}%`} height={15} />
              {withBadge && <Skeleton width={64} height={18} radius={10} />}
            </div>
            <Skeleton width={`${25 + (i%2)*10}%`} height={11} />
          </div>
        </div>
      ))}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="card">
      <StatCardsSkeleton />
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,gap:12}}>
        <Skeleton width={140} height={18} />
        <Skeleton width={110} height={36} radius={10} />
      </div>
      <Skeleton height={40} radius={10} style={{marginBottom:16}} />
      <RowSkeleton count={5} withBadge />
    </div>
  );
}

// ── Trash view ──────────────────────────────────────────────────────
function TrashView({ tasks, invoices, loading, isSuperAdmin, showTasks, showInvoices, onRestoreTask, onPurgeTask, onRestoreInvoice, onPurgeInvoice }) {
  return (
    <div className="card">
      <strong style={{fontSize:17}}>Trash</strong>
      <p className="muted" style={{fontSize:13, marginTop:4}}>
        Deleted tasks and invoices land here first — nothing is gone for good until it&apos;s permanently removed.
        {!isSuperAdmin && ' Only the super admin can permanently delete items.'}
      </p>

      {loading && <RowSkeleton count={4} />}

      {!loading && showTasks && (
        <div style={{marginTop:20}}>
          <div className="nav-row"><strong>Tasks</strong></div>
          {tasks.length === 0 && <p className="muted" style={{fontSize:13}}>Trash is empty.</p>}
          {tasks.map(t => (
            <div key={t.id} className="task-row">
              <div style={{minWidth:0, flex:1}}>
                <div style={{fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t.task_title}</div>
                <div className="muted" style={{fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t.client_name} · deleted {new Date(t.archived_at).toLocaleString()}</div>
              </div>
              <div style={{display:'flex',gap:8,flexShrink:0}}>
                <button className="secondary" onClick={()=>onRestoreTask(t.id)}>Restore</button>
                {isSuperAdmin && <button className="danger" onClick={()=>onPurgeTask(t.id)}>Delete forever</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && showInvoices && (
        <div style={{marginTop:24}}>
          <div className="nav-row"><strong>Invoices</strong></div>
          {invoices.length === 0 && <p className="muted" style={{fontSize:13}}>Trash is empty.</p>}
          {invoices.map(i => (
            <div key={i.id} className="task-row">
              <div style={{minWidth:0, flex:1}}>
                <div style={{fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{i.invoice_number} — {i.client_name}</div>
                <div className="muted" style={{fontSize:12}}>deleted {new Date(i.archived_at).toLocaleString()}</div>
              </div>
              <div style={{display:'flex',gap:8,flexShrink:0}}>
                <button className="secondary" onClick={()=>onRestoreInvoice(i.id)}>Restore</button>
                {isSuperAdmin && <button className="danger" onClick={()=>onPurgeInvoice(i.id)}>Delete forever</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  const titleId = useId();
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement;
    const panel = panelRef.current;
    panel?.focus();
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-panel card" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panelRef}>
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="secondary modal-close" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Task form ───────────────────────────────────────────────────────
function MultiSelectDropdown({ options, selected, onChange, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const selectedSet = new Set((selected || []).map(String));
  const selectedLabels = options.filter(o => selectedSet.has(String(o.id))).map(o => o.name);

  function toggle(id) {
    const idStr = String(id);
    const next = selectedSet.has(idStr)
      ? (selected || []).filter(v => String(v) !== idStr)
      : [...(selected || []), idStr];
    onChange(next);
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="secondary"
        style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabels.length ? selectedLabels.join(', ') : placeholder}
        </span>
        <span aria-hidden="true" style={{ marginLeft: 8, color: 'var(--ink-soft)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20,
            background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 6,
            maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}
        >
          {options.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 13, color: 'var(--ink-soft)' }}>No options available</div>
          )}
          {options.map(o => (
            <label
              key={o.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13 }}
            >
              <input
                type="checkbox"
                checked={selectedSet.has(String(o.id))}
                onChange={() => toggle(o.id)}
                style={{ width: 'auto', flexshrink: 0, margin: 0 }}
              />
              <span>{o.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskForm({ editing, team, categories, clientNames, onChange, onSave, onCancel }) {
  const [activity, setActivity] = useState([]);
  const [showActivity, setShowActivity] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!editing?.task_title?.trim() || !editing?.client_name?.trim()) {
      setError('Client name and task title are required.');
      return;
    }
    if (editing.payment_status !== 'unpaid' && Number(editing.amount_paid || 0) <= 0) {
      setError('Enter an amount greater than zero for a paid task.');
      return;
    }
    try {
      await onSave(editing);
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  async function loadActivity() {
    if (!editing?.id) return;
    setLoadingActivity(true);
    try {
      const response = await fetch(`/api/tasks/${editing.id}/activity`);
      const data = await readApiResponse(response);
      setActivity(Array.isArray(data) ? data : []);
    } catch {
      setActivity([]);
    } finally {
      setLoadingActivity(false);
    }
  }

  if (!editing) return null;
  function set(field, value) { onChange({...editing, [field]: value}); }
  // Completed work is locked. Payment and the status that reopens it stay
  // editable; everything else is disabled here and refused by the API.
  const locked = Boolean(editing.id) && editing.status === 'done';
  return (
    <Modal title={editing.id ? 'Edit task' : 'New task'} onClose={onCancel}>
      <div className="modal-form">
        {locked && (
          <div className="alert" style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span aria-hidden="true">🔒</span>
            <span>
              <strong>This task is completed and locked.</strong>
              <br />
              Its plan and details are frozen so the client link and history stay accurate.
              You can still settle the payment below, or change the status to reopen it for editing.
            </span>
          </div>
        )}
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="form-grid" style={{marginTop:16}}>
          <div>
            <label>Client name</label>
            <input list="client-names-list" value={editing.client_name} onChange={(e)=>set('client_name',e.target.value)} placeholder="e.g. POB Trust" />
            <datalist id="client-names-list">
              {(clientNames||[]).map(n => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div>
            <label>Task title</label>
            <input value={editing.task_title} onChange={(e)=>set('task_title',e.target.value)} placeholder="e.g. Homepage redesign" />
          </div>
          <div>
            <label>Client email (for update emails)</label>
            <input type="email" value={editing.client_email||''} onChange={(e)=>set('client_email',e.target.value)} placeholder="optional" />
          </div>
          <div>
            <label>Project name</label>
            <input value={editing.project_name||''} onChange={(e)=>set('project_name',e.target.value)} placeholder="Optional project" />
          </div>
          <div>
            <label>Priority</label>
            <select value={editing.priority==='normal'?'medium':editing.priority||'medium'} onChange={(e)=>set('priority',e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label>Start date</label>
            <input type="date" value={editing.start_date||''} onChange={(e)=>set('start_date',e.target.value)} />
          </div>
          <div>
            <label>Due date</label>
            <input type="date" value={editing.due_date||''} onChange={(e)=>set('due_date',e.target.value)} />
          </div>
          <div>
            <label>Assigned to</label>
            <MultiSelectDropdown
              options={team.map(m => ({ id: m.id, name: m.name }))}
              selected={editing.assignee_ids || []}
              placeholder="Select team members"
              onChange={(values) => {
                onChange({ ...editing, assignee_ids: values, assigned_to: values[0] || '' });
              }}
            />
            {(editing.assignee_ids||[]).length > 0 && (
              <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
                {editing.assignee_ids.length} selected · first checked is primary.
              </p>
            )}
          </div>
          <div>
            <label>Category</label>
            <select value={editing.category_id||''} onChange={(e)=>set('category_id',e.target.value)}>
              <option value="">No category</option>
              {categories.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <label style={{fontSize:13, color:'var(--ink-soft)'}}>Description</label>
        <textarea rows={4} value={editing.description||''} onChange={(e)=>set('description',e.target.value)}
          placeholder="What is being delivered" style={{marginTop:4}} />
        <label style={{fontSize:13, color:'var(--ink-soft)', marginTop:10}}>Notes for the client</label>
        <textarea rows={2} value={editing.notes||''} onChange={(e)=>set('notes',e.target.value)}
          placeholder="Optional message shown under &quot;Notes from our team&quot; on the client link" style={{marginTop:4}} />
        <label className="checkbox-row">
          <input type="checkbox" checked={!!editing.client_visible} onChange={(e)=>set('client_visible',e.target.checked)} />
          <span>Visible on the client link</span>
        </label>
        </fieldset>

        <div className="form-grid" style={{ marginTop: locked ? 16 : 0 }}>
          <div>
            <label>Status</label>
            <select value={editing.status||'not_started'} onChange={(e)=>set('status',e.target.value)}>
              {Object.entries(STATUS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
            {locked && <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>Pick another status to reopen this task.</p>}
          </div>
          <div>
            <label>Payment status</label>
            <select value={editing.payment_status||'unpaid'} onChange={(e)=>set('payment_status',e.target.value)}>
              {Object.entries(TASK_PAYMENT_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {editing.payment_status !== 'unpaid' && (
            <div>
              <label>Amount paid</label>
              <input type="number" min="0" step="0.01" value={editing.amount_paid||0} onChange={(e)=>set('amount_paid',e.target.value)} />
            </div>
          )}
        </div>

        {editing.id && (
          <div style={{marginTop:16, borderTop:'1px solid var(--line)', paddingTop:12}}>
            <button type="button" className="secondary" style={{fontSize:12, padding:'4px 10px'}}
              onClick={()=>{ const next = !showActivity; setShowActivity(next); if (next && activity.length===0) loadActivity(); }}>
              {showActivity ? 'Hide history' : '🕘 View history'}
            </button>
            {showActivity && (
              <div style={{marginTop:10}}>
                {loadingActivity && <p className="muted" style={{fontSize:12}}>Loading…</p>}
                {!loadingActivity && activity.length===0 && <p className="muted" style={{fontSize:12}}>No activity recorded yet.</p>}
                {!loadingActivity && activity.map(a => (
                  <div key={a.id} style={{fontSize:12, padding:'6px 0', borderBottom:'1px solid var(--line)'}}>
                    <div>{a.message}</div>
                    <div className="muted" style={{fontSize:11}}>{new Date(a.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <p className="alert error-alert" role="alert">{error}</p>}
        <div style={{display:'flex',gap:8,marginTop:16}}>
          <button type="button" onClick={submit}>
            {locked ? (editing.status === 'done' ? 'Save payment' : 'Reopen and save') : 'Save task'}
          </button>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Team view ───────────────────────────────────────────────────────
// ── Calendar view ───────────────────────────────────────────────────
function CalendarView({ tasks, monthOffset, setMonthOffset, onAdd, onEdit, canAdd }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const today = todayISO();
  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel  = viewDate.toLocaleDateString(undefined, { month:'long', year:'numeric' });

  const cells = [];
  for (let i=0; i<firstDay; i++) cells.push(null);
  for (let d=1; d<=daysInMonth; d++) cells.push(d);

  function isoFor(day) {
    return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  function tasksOnDay(day) {
    const iso = isoFor(day);
    return tasks.filter((t) => {
      const start = t.start_date?.slice(0,10);
      const due   = t.due_date?.slice(0,10);
      return start && due && start <= iso && iso <= due;
    });
  }

  const selectedTasks = selectedDay ? tasksOnDay(selectedDay) : [];

  return (
    <div>
      <div className="card">
        {/* Nav */}
        <div className="nav-row">
          <div style={{display:'flex',alignItems:'center',gap:6,background:'var(--share-bg)',borderRadius:10,padding:'4px 6px'}}>
            <button className="secondary" style={{padding:'5px 12px',border:'none',background:'transparent'}}
              onClick={()=>{setMonthOffset(monthOffset-1);setSelectedDay(null);}}>←</button>
            <strong style={{fontSize:15, minWidth:140, textAlign:'center'}}>{monthLabel}</strong>
            <button className="secondary" style={{padding:'5px 12px',border:'none',background:'transparent'}}
              onClick={()=>{setMonthOffset(monthOffset+1);setSelectedDay(null);}}>→</button>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button className="secondary" style={{fontSize:13,padding:'6px 12px'}}
              onClick={()=>{setMonthOffset(0);setSelectedDay(null);}}>Today</button>
            {canAdd && <button onClick={onAdd}>+ Add task</button>}
          </div>
        </div>

        {/* Day headers */}
        <div className="calendar">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d)=>(
            <div key={d} className="cal-header-cell">{d}</div>
          ))}

          {/* Cells */}
          {cells.map((day, i) => {
            if (!day) return <div key={i} className="cal-cell empty"></div>;
            const iso = isoFor(day);
            const dayTasks = tasksOnDay(day);
            const isToday = iso === today;
            const hasTasks = dayTasks.length > 0;
            const isSelected = selectedDay === day;
            const MAX_SHOW = 2;
            return (
              <div
                key={i}
                className={`cal-cell ${hasTasks?'has-tasks':''} ${isToday?'is-today':''} ${isSelected?'is-selected':''}`}
                onClick={()=>setSelectedDay(isSelected ? null : day)}
                style={{cursor: hasTasks?'pointer':'default'}}
              >
                <div className="daynum">{day}</div>
                {dayTasks.slice(0, MAX_SHOW).map((t)=>(
                  <div key={t.id} className="cal-task"
                    style={{background: STATUS_COLORS[t.status]}}
                    title={`${t.task_title} — ${t.client_name}`}>
                    {t.task_title}
                  </div>
                ))}
                {dayTasks.length > MAX_SHOW && (
                  <div className="cal-more">+{dayTasks.length - MAX_SHOW} more</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="cal-legend">
          {Object.entries(STATUS_LABELS).map(([k,v])=>(
            <div key={k} className="legend-item">
              <div className="legend-dot" style={{background:`var(--${k})`}}></div>
              {v}
            </div>
          ))}
          <div className="legend-item">
            <div className="legend-dot" style={{background:'var(--cal-today)',border:'2px solid var(--today-ring)',boxSizing:'border-box'}}></div>
            Today
          </div>
        </div>
      </div>

      {/* Day detail panel */}
      {selectedDay && (
        <div className="card" style={{marginTop:0}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <strong>
              {new Date(year, month, selectedDay).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}
            </strong>
            <button className="secondary" style={{padding:'4px 10px',fontSize:12}} onClick={()=>setSelectedDay(null)}>✕</button>
          </div>
          {selectedTasks.length === 0
            ? <p className="muted" style={{margin:0}}>No tasks on this day.</p>
            : selectedTasks.map((t)=>(
              <div key={t.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--line)',cursor:'pointer'}}
                onClick={()=>onEdit(t)} title="Click to edit this task">
                <div style={{width:10,height:10,borderRadius:'50%',background:STATUS_COLORS[t.status],flexShrink:0}}></div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t.task_title}</div>
                  <div className="muted" style={{fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t.client_name} · {STATUS_LABELS[t.status]}</div>
                </div>
                <span className="muted" style={{fontSize:12, flexShrink:0}}>Edit →</span>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ── Invoice helpers ─────────────────────────────────────────────────
// Tones come from tokens so these read correctly in dark mode.
const PS_STYLES = {
  unpaid:         { label:'Unpaid',         bg:'var(--red-bg)',   color:'var(--red-fg)' },
  partially_paid: { label:'Partially Paid', bg:'var(--amber-bg)', color:'var(--amber-fg)' },
  paid:           { label:'Paid',           bg:'var(--green-bg)', color:'var(--green-fg)' },
};

function money(n) {
  // Use en-US number grouping (1,000,000) which is standard on invoices
  // even for PKR. The currency symbol is prepended separately by currencySymbol().
  return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}

// ── Currency ─────────────────────────────────────────────────────────
const CURRENCIES = {
  PKR: { symbol: 'Rs ', label: 'PKR — Pakistani Rupee' },
  USD: { symbol: '$',  label: 'USD — US Dollar' },
  GBP: { symbol: '£',  label: 'GBP — British Pound' },
  EUR: { symbol: '€',  label: 'EUR — Euro' },
  AED: { symbol: 'AED ', label: 'AED — UAE Dirham' },
  SAR: { symbol: 'SAR ', label: 'SAR — Saudi Riyal' },
};
function currencySymbol(code) {
  return (CURRENCIES[code] || CURRENCIES.PKR).symbol;
}

// ── CSV export ──────────────────────────────────────────────────────
function downloadCsv(filename, rows, columns) {
  const header = columns.map(c => safeCsvCell(c.label)).join(',');
  const lines = rows.map(row => columns.map(c => safeCsvCell(typeof c.value==='function' ? c.value(row) : row[c.value])).join(','));
  const csv = [header, ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function exportTasksCsv(tasks) {
  downloadCsv(`tasks-export-${new Date().toISOString().slice(0,10)}.csv`, tasks, [
    { label: 'Client', value: 'client_name' },
    { label: 'Task', value: 'task_title' },
    { label: 'Assigned to', value: t => assigneeLabel(t) },
    { label: 'Category', value: 'category_name' },
    { label: 'Start date', value: t => t.start_date?.slice(0,10) },
    { label: 'Due date', value: t => t.due_date?.slice(0,10) },
    { label: 'Status', value: t => STATUS_LABELS[t.status] || t.status },
    { label: 'Priority', value: 'priority' },
    { label: 'Payment status', value: t => TASK_PAYMENT_LABELS[t.payment_status] || t.payment_status },
    { label: 'Client email', value: 'client_email' },
    { label: 'Description', value: 'description' },
    { label: 'Project', value: 'project_name' },
  ]);
}
function exportInvoicesCsv(invoices) {
  downloadCsv(`invoices-export-${new Date().toISOString().slice(0,10)}.csv`, invoices, [
    { label: 'Invoice #', value: 'invoice_number' },
    { label: 'Client', value: 'client_name' },
    { label: 'Company', value: 'client_company' },
    { label: 'Invoice date', value: i => i.invoice_date?.slice(0,10) },
    { label: 'Due date', value: i => i.due_date?.slice(0,10) },
    { label: 'Currency', value: 'currency' },
    { label: 'Total', value: i => calcInvoiceTotal(i.items, i.tax_rate, i.discount).total.toFixed(2) },
    { label: 'Amount paid', value: i => Number(i.amount_paid||0).toFixed(2) },
    { label: 'Payment status', value: 'payment_status' },
    { label: 'Project', value: 'project_name' },
  ]);
}

// Next sequential invoice number for the current year, e.g. INV-2026-1001.
// The sequence resets each calendar year rather than counting globally,
// which is what most bookkeeping/accounting references expect.
function nextInvoiceNumber(invoices) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  // Match trailing number from any format: INV-2026-1005, INV-1005, etc.
  const nums = (invoices||[])
    .map(inv => {
      const m = String(inv.invoice_number||'').match(/(\d+)$/);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter(n => n !== null);
  // Start from 1005 if no invoices exist yet
  const next = nums.length ? Math.max(...nums) + 1 : 1005;
  return `${prefix}${next}`;
}

// ── Invoice list ────────────────────────────────────────────────────
function InvoiceList({ invoices, origin, userId, canCreate, canEdit, canEditOwn, canManage, canDelete, canRecordPayments, onAdd, onEdit, onDelete, onStatusChange, onCopyInvoice, onShareChange }) {
  // Group totals by currency since invoices can be issued in different currencies
  const outstandingByCcy = {};
  const paidThisMonthByCcy = {};
  invoices.forEach(inv => {
    const calculated = calcInvoiceTotal(inv.items, inv.tax_rate, inv.discount);
    const total = Number(inv.total ?? calculated.total);
    const amountPaid = Number(inv.amount_paid || 0);
    const ccy = inv.currency || 'PKR';
    if (total - amountPaid > 0) outstandingByCcy[ccy] = (outstandingByCcy[ccy]||0) + total - amountPaid;
    if (inv.payment_status === 'paid' || inv.paid_this_month > 0) {
      const paidThisMonth = inv.paid_this_month === null || inv.paid_this_month === undefined
        ? (inv.payment_status === 'paid' && inv.updated_at ? amountPaid : 0)
        : Number(inv.paid_this_month || 0);
      if (paidThisMonth > 0) paidThisMonthByCcy[ccy] = (paidThisMonthByCcy[ccy]||0) + paidThisMonth;
    }
  });
  function fmtByCcy(obj) {
    const entries = Object.entries(obj);
    if (entries.length === 0) return `${currencySymbol('PKR')}0.00`;
    return entries.map(([ccy,val]) => `${currencySymbol(ccy)}${money(val)}`).join(' + ');
  }

  function canEditInvoice(invoice) {
    return canEdit && (canManage || (canEditOwn && String(invoice.created_by_id) === String(userId)));
  }

  return (
    <div className="card">
      {/* Totals summary */}
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16}}>
        <div style={{flex:'1 1 180px',background:'var(--accent-soft)',borderRadius:10,padding:'10px 14px'}}>
          <div style={{fontSize:18,fontWeight:800,color:'var(--red-fg)'}}>{fmtByCcy(outstandingByCcy)}</div>
          <div className="muted" style={{fontSize:12}}>Total outstanding</div>
        </div>
        <div style={{flex:'1 1 180px',background:'var(--accent-soft)',borderRadius:10,padding:'10px 14px'}}>
          <div style={{fontSize:18,fontWeight:800,color:'var(--green-fg)'}}>{fmtByCcy(paidThisMonthByCcy)}</div>
          <div className="muted" style={{fontSize:12}}>Paid this month</div>
        </div>
      </div>

      <div className="nav-row">
        <strong style={{fontSize:16}}>Invoices</strong>
        <div style={{display:'flex',gap:8}}>
          <button className="secondary" onClick={()=>exportInvoicesCsv(invoices)}>Export CSV</button>
          {canCreate && <button onClick={onAdd}>+ New invoice</button>}
        </div>
      </div>
      {invoices.length===0 && <p className="muted">No invoices yet. Create one to get started.</p>}
      {invoices.map(inv => {
        const total = Number(inv.total ?? calcInvoiceTotal(inv.items, inv.tax_rate, inv.discount).total);
        const ps = PS_STYLES[inv.payment_status] || PS_STYLES.unpaid;
        return (
          <div key={inv.id} className="task-row">
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <strong style={{fontSize:15}}>{inv.invoice_number}</strong>
                <span style={{fontSize:13,color:'var(--ink-soft)'}}>· {inv.client_name}</span>
                <span style={{padding:'2px 9px',borderRadius:10,fontSize:11,fontWeight:700,background:ps.bg,color:ps.color}}>
                  {ps.label}{inv.payment_status==='partially_paid' ? ` · ${currencySymbol(inv.currency)}${money(inv.amount_paid||0)} of ${currencySymbol(inv.currency)}${money(total)}` : ''}
                </span>
              </div>
              <p className="muted" style={{margin:'4px 0 0',fontSize:13}}>
                {inv.project_name && `${inv.project_name} · `}Due {fmt(inv.due_date)} · <strong style={{color:'var(--ink)'}}>{currencySymbol(inv.currency)}{money(total)}</strong>
              </p>
              <div className="share-link" style={{marginTop:8,maxWidth:420,flexWrap:'wrap'}}>
                {inv.share_token ? (
                  <>
                    <span style={{flex:1,minWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>/invoice/{inv.share_token}</span>
                    <button className="secondary" style={{padding:'4px 10px',whiteSpace:'nowrap'}}
                      onClick={() => onCopyInvoice(inv)}>Copy link</button>
                    <button className="secondary" style={{padding:'4px 10px',whiteSpace:'nowrap'}}
                      onClick={() => onShareChange('invoice', inv, 'regenerate_share')}>New link</button>
                    <button className="secondary" style={{padding:'4px 10px',whiteSpace:'nowrap'}}
                      title="Stop this link working immediately"
                      onClick={() => onShareChange('invoice', inv, 'revoke_share')}>Revoke</button>
                  </>
                ) : (
                  <>
                    <span className="muted" style={{flex:1,fontSize:13}}>
                      No active share link - this invoice is not reachable by clients.
                    </span>
                    <button className="secondary" style={{padding:'4px 10px',whiteSpace:'nowrap'}}
                      onClick={() => onShareChange('invoice', inv, 'regenerate_share')}>Create link</button>
                  </>
                )}
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6,flexShrink:0}}>
              {canRecordPayments && (
                <select value={inv.payment_status||'unpaid'}
                  aria-label={`Payment status for ${inv.invoice_number}`}
                  onChange={e=>onStatusChange(inv.id,e.target.value)}
                  style={{fontSize:12,padding:'4px 8px',border:'1px solid var(--line)',borderRadius:6,background:'var(--card)',color:'var(--ink)'}}>
                  <option value="unpaid">Unpaid</option>
                  <option value="partially_paid">Partially Paid</option>
                  <option value="paid">Paid</option>
                </select>
              )}
              <div style={{display:'flex',gap:6}}>
                {canEditInvoice(inv) && <button className="secondary" style={{flex:1,fontSize:12,padding:'4px 8px'}} onClick={()=>onEdit(inv)}>Edit</button>}
                {canDelete && <button className="danger"    style={{flex:1,fontSize:12,padding:'4px 8px'}} onClick={()=>onDelete(inv.id)}>Delete</button>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Invoice form modal ──────────────────────────────────────────────
function emptyInvoice(invoices) {
  const today = new Date();
  const due   = new Date(today); due.setDate(due.getDate()+14);
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  return {
    invoice_number: nextInvoiceNumber(invoices),
    client_name:'', client_company:'', client_address:'', client_email:'',
    invoice_date: iso(today), due_date: iso(due),
      project_name:'', tax_rate:0, discount:0, notes:'', payment_status:'unpaid', amount_paid:0, currency:'PKR',
      client_visible:false,
    items:[{ description:'', quantity:1, unit_price:0 }],
  };
}

function InvoiceForm({ invoice, invoices, clientNames, onSave, onCancel }) {
  const [form, setForm] = useState(invoice ? {currency:'PKR', ...invoice, items: invoice.items?.length ? invoice.items : [{description:'',quantity:1,unit_price:0}] } : emptyInvoice(invoices));
  const [activity, setActivity] = useState([]);
  const [showActivity, setShowActivity] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!form.client_name?.trim() || !form.client_email?.trim() || !form.invoice_date || !form.due_date) {
      setError('Client name, client email, invoice date, and due date are required.');
      return;
    }
    if (!form.items.length || form.items.some(item => !item.description.trim() || Number(item.quantity) <= 0 || Number(item.unit_price) < 0)) {
      setError('Each invoice line needs a description, positive quantity, and non-negative price.');
      return;
    }
    if (form.payment_status === 'partially_paid' && (Number(form.amount_paid || 0) <= 0 || Number(form.amount_paid || 0) >= total)) {
      setError('Partial payment must be between zero and the invoice total.');
      return;
    }
    try {
      await onSave(form);
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  async function loadActivity() {
    if (!form.id) return;
    setLoadingActivity(true);
    try {
      const response = await fetch(`/api/invoices/${form.id}/activity`);
      const data = await readApiResponse(response);
      setActivity(Array.isArray(data) ? data : []);
    } catch {
      setActivity([]);
    } finally {
      setLoadingActivity(false);
    }
  }

  function setF(k,v) { setForm(p=>({...p,[k]:v})); }
  function setItem(i,k,v) {
    setForm(p=>{ const items=[...p.items]; items[i]={...items[i],[k]:v}; return {...p,items}; });
  }
  function addItem() { setForm(p=>({...p,items:[...p.items,{description:'',quantity:1,unit_price:0}]})); }
  function removeItem(i) { setForm(p=>({...p,items:p.items.filter((_,idx)=>idx!==i)})); }

  const { subtotal, tax: taxAmt, total } = calcInvoiceTotal(form.items, form.tax_rate, form.discount);

  return (
    <Modal title={form.id ? 'Edit invoice' : 'New invoice'} onClose={onCancel}>
      <div className="modal-form">

        {/* Client + invoice details */}
        <div className="form-grid" style={{marginTop:16}}>
          <div><label>Invoice #</label><input value={form.invoice_number} readOnly aria-readonly="true" /></div>
          <div><label>Currency</label>
            <select value={form.currency||'PKR'} onChange={e=>setF('currency',e.target.value)}>
              {Object.entries(CURRENCIES).map(([code,c])=>(
                <option key={code} value={code}>{c.label}</option>
              ))}
            </select>
          </div>
          <div><label>Payment status</label>
            <select value={form.payment_status} onChange={e=>{
              const v = e.target.value;
              setForm(p => ({...p, payment_status: v,
                amount_paid: v === 'paid' ? calcInvoiceTotal(p.items,p.tax_rate,p.discount).total
                  : v === 'unpaid' ? 0 : p.amount_paid,
              }));
            }}>
              <option value="unpaid">Unpaid</option>
              <option value="partially_paid">Partially Paid</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          {form.payment_status === 'partially_paid' && (
            <div><label>Amount paid so far</label>
              <input type="number" min="0" step="0.01" value={form.amount_paid ?? 0}
                onChange={e=>setF('amount_paid', Number(e.target.value))} />
              <p className="muted" style={{fontSize:11, margin:'4px 0 0'}}>
                Balance remaining: {currencySymbol(form.currency)}{money(Math.max(0, calcInvoiceTotal(form.items,form.tax_rate,form.discount).total - Number(form.amount_paid||0)))}
              </p>
            </div>
          )}
          <div><label>Client name *</label>
            <input list="invoice-client-names-list" value={form.client_name} onChange={e=>setF('client_name',e.target.value)} placeholder="e.g. Ahmad Raza" />
            <datalist id="invoice-client-names-list">
              {(clientNames||[]).map(n => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div><label>Client company</label><input value={form.client_company} onChange={e=>setF('client_company',e.target.value)} placeholder="Company name" /></div>
          <div><label>Client email</label><input value={form.client_email} onChange={e=>setF('client_email',e.target.value)} placeholder="client@email.com" /></div>
          <div><label>Client address</label><input value={form.client_address} onChange={e=>setF('client_address',e.target.value)} placeholder="City, ZIP" /></div>
          <div><label>Invoice date *</label><input type="date" value={form.invoice_date} onChange={e=>setF('invoice_date',e.target.value)} /></div>
          <div><label>Due date *</label><input type="date" value={form.due_date} onChange={e=>setF('due_date',e.target.value)} /></div>
          <div style={{gridColumn:'1/-1'}}><label>Project name</label><input value={form.project_name} onChange={e=>setF('project_name',e.target.value)} placeholder="e.g. WordPress Site Build" /></div>
        </div>

        {/* Line items */}
        <div style={{marginTop:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <label style={{fontSize:13,fontWeight:600}}>Line items</label>
            <button className="secondary" style={{fontSize:12,padding:'4px 10px'}} onClick={addItem}>+ Add row</button>
          </div>
          <div style={{overflowX:'auto', WebkitOverflowScrolling:'touch'}}>
          <div style={{background:'var(--share-bg)',borderRadius:8,overflow:'hidden',minWidth:460}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 70px 100px 90px 32px',gap:6,padding:'8px 10px',
              borderBottom:'1px solid var(--line)',fontSize:11,fontWeight:700,color:'var(--ink-soft)',textTransform:'uppercase'}}>
              <span>Description</span><span>Qty</span><span>Unit price</span><span style={{textAlign:'right'}}>Amount</span><span></span>
            </div>
            {form.items.map((item,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 70px 100px 90px 32px',gap:6,padding:'6px 10px',alignItems:'center',borderBottom:'1px solid var(--line)'}}>
                <input value={item.description} onChange={e=>setItem(i,'description',e.target.value)} placeholder="Service description" style={{margin:0,padding:'5px 8px',fontSize:13}} />
                <input type="number" value={item.quantity} onChange={e=>setItem(i,'quantity',e.target.value)} style={{margin:0,padding:'5px 8px',fontSize:13,textAlign:'center'}} />
                <input type="number" value={item.unit_price} onChange={e=>setItem(i,'unit_price',e.target.value)} style={{margin:0,padding:'5px 8px',fontSize:13}} placeholder="0.00" />
                <span style={{textAlign:'right',fontSize:13,fontWeight:600}}>{currencySymbol(form.currency)}{money(Number(item.quantity||1)*Number(item.unit_price||0))}</span>
                <button onClick={()=>removeItem(i)} style={{background:'none',border:'none',color:'var(--ink-soft)',cursor:'pointer',fontSize:16,padding:0,lineHeight:1}}>×</button>
              </div>
            ))}
          </div>
          </div>
        </div>

        {/* Totals */}
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:12}}>
          <div style={{minWidth:220}}>
            <div style={{display:'flex',gap:12,marginBottom:8}}>
              <div style={{flex:1}}><label>Tax %</label><input type="number" value={form.tax_rate} onChange={e=>setF('tax_rate',e.target.value)} style={{margin:0}} /></div>
              <div style={{flex:1}}><label>Discount ({currencySymbol(form.currency).trim()})</label><input type="number" value={form.discount} onChange={e=>setF('discount',e.target.value)} style={{margin:0}} /></div>
            </div>
            {[['Subtotal',`${currencySymbol(form.currency)}${money(subtotal)}`],[`Tax (${form.tax_rate||0}%)`,`${currencySymbol(form.currency)}${money(taxAmt)}`],[`Discount`,`-${currencySymbol(form.currency)}${money(form.discount||0)}`]].map(([k,v])=>(
              <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'var(--ink-soft)',padding:'3px 0'}}><span>{k}</span><span>{v}</span></div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',fontWeight:800,fontSize:16,color:'var(--accent)',borderTop:'2px solid var(--accent)',marginTop:6,paddingTop:6}}>
              <span>Total</span><span>{currencySymbol(form.currency)}{money(total)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div style={{marginTop:16}}>
          <label>Notes (optional)</label>
          <textarea rows={2} value={form.notes} onChange={e=>setF('notes',e.target.value)} placeholder="Payment instructions or thank you message..." style={{marginTop:4}} />
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={!!form.client_visible} onChange={(e)=>setF('client_visible',e.target.checked)} />
          <span>Email the client about this invoice</span>
        </label>

        {form.id && (
          <div style={{marginTop:16, borderTop:'1px solid var(--line)', paddingTop:12}}>
            <button type="button" className="secondary" style={{fontSize:12, padding:'4px 10px'}}
              onClick={()=>{ const next = !showActivity; setShowActivity(next); if (next && activity.length===0) loadActivity(); }}>
              {showActivity ? 'Hide history' : '🕘 View history'}
            </button>
            {showActivity && (
              <div style={{marginTop:10}}>
                {loadingActivity && <p className="muted" style={{fontSize:12}}>Loading…</p>}
                {!loadingActivity && activity.length===0 && <p className="muted" style={{fontSize:12}}>No activity recorded yet.</p>}
                {!loadingActivity && activity.map(a => (
                  <div key={a.id} style={{fontSize:12, padding:'6px 0', borderBottom:'1px solid var(--line)'}}>
                    <div>{a.message}{a.actor ? ` — ${a.actor}` : ''}</div>
                    <div className="muted" style={{fontSize:11}}>{new Date(a.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <p className="alert error-alert" role="alert">{error}</p>}
        <div style={{display:'flex',gap:8,marginTop:16}}>
          <button type="button" onClick={submit}>Save invoice</button>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
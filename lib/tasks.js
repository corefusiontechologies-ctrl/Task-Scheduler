import { daysBetween } from './dates';
import { getSql } from './db';
import { ApiError } from './http';
import {
  oneOf,
  optionalId,
  optionalNumber,
  optionalString,
  requiredBoolean,
  requiredDate,
  requiredNumber,
  requiredString,
} from './validation';

export const TASK_STATUSES = ['not_started', 'in_progress', 'review', 'done'];
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const TASK_PAYMENT_STATUSES = ['unpaid', 'partially_paid', 'paid'];

function descriptionValue(value) {
  if (value === undefined || value === null) return '';
  return requiredString(value, 'Description', { min: 0, max: 20000, trim: false });
}

export function taskCapacity() {
  const configured = Number(process.env.TASK_CAPACITY_PER_MEMBER || 1);
  return Number.isFinite(configured) ? Math.min(100, Math.max(1, Math.floor(configured))) : 1;
}

function assigneeList(body, current) {
  if ('assignee_ids' in body) {
    const raw = body.assignee_ids;
    if (raw === null || raw === undefined || raw === '') return [];
    if (!Array.isArray(raw)) throw new ApiError(400, 'Assignees must be a list of team member IDs');
    if (raw.length > 20) throw new ApiError(400, 'A task can have at most 20 assignees');
    const ids = raw.map(value => optionalId(value, 'Assignee'));
    return [...new Set(ids.filter(Boolean))];
  }
  if ('assigned_to' in body) {
    const single = optionalId(body.assigned_to, 'Assigned member');
    return single ? [single] : [];
  }
  return (current.assignee_ids || []).map(Number).filter(Boolean);
}

export function normalizeTaskInput(body, current = {}) {
  const titleValue = 'title' in body ? body.title : 'task_title' in body ? body.task_title : current.title;
  const priorityValue = 'priority' in body ? body.priority : current.priority || 'medium';
  const assigneeIds = assigneeList(body, current);
  const input = {
    title: requiredString(titleValue, 'Title', { min: 1, max: 255 }),
    description: 'description' in body ? descriptionValue(body.description) : current.description || '',
    client_name: 'client_name' in body ? optionalString(body.client_name, 'Client name', { min: 1, max: 255 }) || '' : current.client_name || '',
    client_email: 'client_email' in body
      ? optionalString(body.client_email, 'Client email', { min: 3, max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }) || ''
      : current.client_email || '',
    project_name: 'project_name' in body ? optionalString(body.project_name, 'Project name', { min: 1, max: 255 }) || '' : current.project_name || '',
    category_id: 'category_id' in body ? optionalId(body.category_id, 'Category') : current.category_id ?? null,
    assignee_ids: assigneeIds,
    assigned_to: assigneeIds[0] ?? null,
    start_date: 'start_date' in body ? requiredDate(body.start_date, 'Start date') : current.start_date,
    due_date: 'due_date' in body ? requiredDate(body.due_date, 'Due date') : current.due_date,
    status: 'status' in body ? oneOf(body.status, 'Status', TASK_STATUSES) : current.status || 'not_started',
    priority: oneOf(priorityValue === 'normal' ? 'medium' : priorityValue, 'Priority', TASK_PRIORITIES),
    progress: 'progress' in body
      ? requiredNumber(body.progress, 'Progress', { min: 0, max: 100, integer: true })
      : Number(current.progress || 0),
    payment_status: 'payment_status' in body
      ? oneOf(body.payment_status, 'Payment status', TASK_PAYMENT_STATUSES)
      : current.payment_status || 'unpaid',
    amount_paid: 'amount_paid' in body
      ? requiredNumber(body.amount_paid, 'Amount paid', { min: 0, max: 999999999999.99 })
      : Number(current.amount_paid || 0),
    client_visible: 'client_visible' in body
      ? requiredBoolean(body.client_visible, 'Client visibility')
      : !!current.client_visible,
  };
  if (input.status === 'done') input.progress = 100;
  if (!input.start_date || !input.due_date) throw new ApiError(400, 'Task dates are required');
  if (daysBetween(input.start_date, input.due_date) < 0) {
    throw new ApiError(400, 'Due date must be on or after the start date');
  }
  return input;
}

export function describeTaskChanges(before, after) {
  const beforeAssignees = (before.assignee_ids || (before.assigned_to ? [before.assigned_to] : [])).map(Number).join(',');
  const afterAssignees = (after.assignee_ids || (after.assigned_to ? [after.assigned_to] : [])).map(Number).join(',');
  const labels = {
    title: 'title',
    description: 'description',
    client_name: 'client name',
    client_email: 'client email',
    project_name: 'project name',
    category_id: 'category',
    assignees: 'assignees',
    start_date: 'start date',
    due_date: 'due date',
    status: 'status',
    priority: 'priority',
    progress: 'progress',
    payment_status: 'payment status',
    amount_paid: 'amount paid',
    client_visible: 'client visibility',
  };
  return Object.entries(labels)
    .filter(([field]) => {
      if (field === 'assignees') return beforeAssignees !== afterAssignees;
      return String(before[field] ?? '') !== String(after[field] ?? '');
    })
    .map(([field, label]) => {
      if (field === 'assignees') return `${label}: ${beforeAssignees || 'none'} → ${afterAssignees || 'none'}`;
      return `${label}: ${before[field] ?? 'none'} → ${after[field] ?? 'none'}`;
    })
    .join('; ');
}

export async function validateTaskReferences(input) {
  const sql = getSql();
  if (input.category_id) {
    const category = await sql`SELECT id FROM categories WHERE id = ${input.category_id} AND archived_at IS NULL`;
    if (!category[0]) throw new ApiError(400, 'Category does not exist');
  }
  const memberIds = [...new Set((input.assignee_ids || []).map(Number).filter(Boolean))];
  if (memberIds.length) {
    const members = await sql`SELECT id FROM team_members WHERE id = ANY(${memberIds}) AND archived_at IS NULL`;
    if (members.length !== memberIds.length) throw new ApiError(400, 'One or more assigned team members do not exist');
  }
}

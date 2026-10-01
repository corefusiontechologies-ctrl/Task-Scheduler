const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,149}$/;
const colorPattern = /^#[0-9a-f]{6}$/i;

export class ValidationError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.fields = fields;
  }
}

export function requireObject(value, name = 'Request body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${name} must be an object`);
  }
  return value;
}

export function requiredString(value, field, { min = 1, max = 255, pattern, trim = true } = {}) {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`, { [field]: 'Required' });
  const normalized = trim ? value.trim() : value;
  if (normalized.length < min || normalized.length > max || (pattern && !pattern.test(normalized))) {
    throw new ValidationError(`${field} is invalid`, { [field]: `Use ${min}-${max} allowed characters` });
  }
  return normalized;
}

export function optionalString(value, field, options = {}) {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, field, options);
}

export function requiredId(value, field) {
  const text = requiredString(value, field, { min: 1, max: 20, pattern: /^\d+$/ });
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id < 1) throw new ValidationError(`${field} is invalid`, { [field]: 'Invalid ID' });
  return id;
}

export function optionalId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return requiredId(value, field);
}

export function requiredDate(value, field) {
  const date = requiredString(value, field, { min: 10, max: 10, pattern: isoDatePattern, trim: false });
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ValidationError(`${field} is invalid`, { [field]: 'Use YYYY-MM-DD' });
  }
  return date;
}

export function optionalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return requiredDate(value, field);
}

export function requiredNumber(value, field, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new ValidationError(`${field} is invalid`, { [field]: `Use a number between ${min} and ${max}` });
  }
  return number;
}

export function optionalNumber(value, field, options = {}) {
  if (value === undefined || value === null || value === '') return null;
  return requiredNumber(value, field, options);
}

export function requiredBoolean(value, field) {
  if (typeof value !== 'boolean') throw new ValidationError(`${field} must be a boolean`, { [field]: 'Required' });
  return value;
}

export function oneOf(value, field, values) {
  if (!values.includes(value)) throw new ValidationError(`${field} is invalid`, { [field]: `Use one of: ${values.join(', ')}` });
  return value;
}

// Deliberately permissive: only rejects the shapes that cannot be a real
// mailbox. Deliverability is proven by sending, not by pattern matching, so
// this avoids rejecting valid addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(value, field = 'Email') {
  if (value === undefined || value === null || value === '') return null;
  const email = requiredString(value, field, { min: 3, max: 254, trim: true }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError(`${field} is not a valid address`, {
      [field.toLowerCase()]: 'Enter a valid email address',
    });
  }
  return email;
}

export function optionalIdList(value, field, { max = 100 } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) throw new ValidationError(`${field} is invalid`, { [field]: `Use at most ${max} items` });
  return [...new Set(value.map((item, index) => requiredId(item, `${field}[${index}]`)))];
}

export function normalizeUsername(value) {
  return requiredString(value, 'Username', { min: 3, max: 150, pattern: usernamePattern }).toLowerCase();
}

export function optionalColor(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, field, { min: 7, max: 7, pattern: colorPattern });
}

export function requiredTimestamp(value, field) {
  const timestamp = requiredString(value, field, { min: 20, max: 40, trim: false });
  if (Number.isNaN(new Date(timestamp).getTime())) throw new ValidationError(`${field} is invalid`, { [field]: 'Invalid timestamp' });
  return timestamp;
}

export function safeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const guarded = typeof value === 'string' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

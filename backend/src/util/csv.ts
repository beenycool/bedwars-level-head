const escapeCell = (val: any): string => {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString();

  const str = String(val);
  let sanitized = str;

  // Prevent CSV Injection (Formula Injection)
  if (typeof val === 'string' && /^[\t\r=+\-@]/.test(str)) {
    sanitized = `'${str}`;
  }

  if (
    sanitized.includes(',') ||
    sanitized.includes('"') ||
    sanitized.includes('\n') ||
    sanitized.includes('\r') ||
    sanitized.includes('\t')
  ) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }

  return sanitized;
};

export function toCSV(data: any[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const headerRow = headers.map(escapeCell).join(',');
  const rows = data.map(row => {
    return headers.map(fieldName => escapeCell(row[fieldName])).join(',');
  });
  return [headerRow, ...rows].join('\n');
}

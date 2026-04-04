const escapeCell = (val: unknown): string => {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString();

  const str = String(val);
  let sanitized = str;

  // Prevent CSV Injection (Formula Injection)
  if (typeof val === 'string' && /^[ \t\r]*[=+\-@]/.test(str)) {
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

export function toCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);

  // ⚡ Bolt: Replaced .map().join('\n') and intermediate array allocations with direct string concatenation (+=) and a single loop to reduce GC pressure when generating large CSVs
  const numRows = data.length;
  const numCols = headers.length;
  let result = '';
  if (numCols > 0) {
    result = escapeCell(headers[0]);
    for (let c = 1; c < numCols; c++) {
      result += ',';
      result += escapeCell(headers[c]);
    }
  }

  for (let r = 0; r < numRows; r++) {
    const row = data[r];
    if (numCols === 0) {
      result += '\n';
      continue;
    }
    let rowStr = escapeCell(row[headers[0]]);
    for (let c = 1; c < numCols; c++) {
      rowStr += ',';
      rowStr += escapeCell(row[headers[c]]);
    }
    result += '\n';
    result += rowStr;
  }

  return result;
}

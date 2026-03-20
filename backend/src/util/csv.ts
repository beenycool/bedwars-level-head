const escapeCell = (val: any): string => {
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

export function toCSV(data: any[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);

  // ⚡ Bolt: Replaced nested data.map and headers.map with a single pre-allocated array and loops
  // to avoid O(N * C) array allocations and excessive Garbage Collection on large data sets
  const numRows = data.length;
  const numCols = headers.length;
  const rows = new Array<string>(numRows + 1);

  rows[0] = headers.map(escapeCell).join(',');

  for (let r = 0; r < numRows; r++) {
    const row = data[r];
    if (numCols === 0) {
      rows[r + 1] = '';
      continue;
    }
    let rowStr = escapeCell(row[headers[0]]);
    for (let c = 1; c < numCols; c++) {
      rowStr += ',' + escapeCell(row[headers[c]]);
    }
    rows[r + 1] = rowStr;
  }

  return rows.join('\n');
}

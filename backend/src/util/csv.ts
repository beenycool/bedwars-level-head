export function toCSV(data: any[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const headerRow = headers.join(',');
  const rows = data.map(row => {
    return headers.map(fieldName => {
      const val = row[fieldName];
      if (val === null || val === undefined) return '';
      if (val instanceof Date) return val.toISOString();
      let str = String(val);

      // Prevent CSV Injection (Formula Injection)
      if (/^[\t\r=+\-@]/.test(str)) {
        str = `'${str}`;
      }

      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',');
  });
  return [headerRow, ...rows].join('\n');
}

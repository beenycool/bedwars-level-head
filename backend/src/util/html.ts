const HTML_ESCAPE_LOOKUP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

const HTML_ESCAPE_REGEX = /[&<>"'`]/g;

export function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE_REGEX, (match) => HTML_ESCAPE_LOOKUP[match] ?? match);
}

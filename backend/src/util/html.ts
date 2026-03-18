const HTML_ESCAPE_LOOKUP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

const HTML_ESCAPE_REGEX = /[&<>"'`]/g;
const HTML_FAST_ESCAPE_REGEX = /[&<>"'`]/;

export function escapeHtml(value: string): string {
  if (!HTML_FAST_ESCAPE_REGEX.test(value)) return value;
  return value.replace(HTML_ESCAPE_REGEX, (match) => HTML_ESCAPE_LOOKUP[match] ?? match);
}

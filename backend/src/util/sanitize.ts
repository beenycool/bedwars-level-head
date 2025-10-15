export function redact(value: string, visible: number = 4): string {
  if (!value) {
    return '';
  }

  const trimmed = value.trim();
  if (trimmed.length <= visible) {
    return '*'.repeat(trimmed.length);
  }

  const hiddenLength = Math.max(0, trimmed.length - visible);
  return `${'*'.repeat(hiddenLength)}${trimmed.slice(hiddenLength)}`;
}

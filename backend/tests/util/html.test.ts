import {
  csvCell,
  escapeHtml,
  formatLatency,
  formatRelativeTime,
  shortenUuid,
} from '../../src/util/html';

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<script>alert("x") & 'y'</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });

  it('escapes backticks so attribute templates cannot be broken out of', () => {
    expect(escapeHtml('a`b')).toBe('a&#96;b');
  });

  it('renders null and undefined as an empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('formatLatency', () => {
  it('switches to seconds past one second', () => {
    expect(formatLatency(240)).toBe('240 ms');
    expect(formatLatency(1500)).toBe('1.50 s');
    expect(formatLatency(null)).toBe('—');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-11-15T18:00:00Z');

  it('uses coarse buckets', () => {
    expect(formatRelativeTime(new Date(now - 5_000), now)).toBe('5s ago');
    expect(formatRelativeTime(new Date(now - 5 * 60_000), now)).toBe('5m ago');
    expect(formatRelativeTime(new Date(now - 5 * 3_600_000), now)).toBe('5h ago');
    expect(formatRelativeTime(new Date(now - 5 * 86_400_000), now)).toBe('5d ago');
  });

  it('falls back to a date after a month', () => {
    expect(formatRelativeTime(new Date('2026-01-02T03:04:05Z'), now)).toBe('2026-01-02');
  });
});

describe('shortenUuid', () => {
  it('keeps the ends and elides the middle', () => {
    expect(shortenUuid('530fa96a303d42199b5a329d493a5573')).toBe('530fa96a…5573');
    expect(shortenUuid('short')).toBe('short');
  });
});

describe('csvCell', () => {
  it('quotes and doubles embedded quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
    expect(csvCell('@sum')).toBe(`"'@sum"`);
  });
});

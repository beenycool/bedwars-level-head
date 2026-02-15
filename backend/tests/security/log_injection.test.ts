// Mock dependencies to prevent side effects (DB connection)
jest.mock('../../src/services/history', () => ({
  recordPlayerQuery: jest.fn(),
}));

jest.mock('../../src/services/player', () => ({}));

import { sanitizeUrlForLogs } from '../../src/util/requestUtils';

describe('Log Injection Security', () => {
  test('should preserve normal URLs', () => {
    const url = '/api/player/stats';
    expect(sanitizeUrlForLogs(url)).toBe('/api/player/stats');
  });

  test('should redact query parameters', () => {
    const url = '/api/player/stats?apiKey=12345&secret=abc';
    expect(sanitizeUrlForLogs(url)).toBe('/api/player/stats?<redacted>');
  });

  test('should sanitize control characters (newline)', () => {
    const url = '/api/player/stats\n[INFO] Forged Log Entry';
    const sanitized = sanitizeUrlForLogs(url);
    // Expectation: Control characters should be escaped
    expect(sanitized).not.toContain('\n');
    expect(sanitized).toContain('\\x0a');
  });

  test('should sanitize control characters (carriage return)', () => {
    const url = '/api/player/stats\r[INFO] Forged Log Entry';
    const sanitized = sanitizeUrlForLogs(url);
    expect(sanitized).not.toContain('\r');
    expect(sanitized).toContain('\\x0d');
  });

  test('should handle mixed control characters and query params', () => {
    const url = '/api/player/foo\nbar?query=1';
    const sanitized = sanitizeUrlForLogs(url);
    expect(sanitized).toContain('\\x0a');
    expect(sanitized).toContain('?<redacted>');
    expect(sanitized).not.toContain('query=1');
  });
});

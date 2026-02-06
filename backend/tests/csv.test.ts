import { describe, it, expect } from '@jest/globals';
import { toCSV } from '../src/util/csv';

describe('toCSV', () => {
  it('should generate CSV from data array', () => {
    const data = [
      { name: 'Alice', score: 10 },
      { name: 'Bob', score: 20 },
    ];
    const expected = 'name,score\nAlice,10\nBob,20';
    expect(toCSV(data)).toBe(expected);
  });

  it('should handle empty data', () => {
    expect(toCSV([])).toBe('');
  });

  it('should escape fields containing commas, quotes, or newlines', () => {
    const data = [
      { name: 'Alice, Bob', desc: 'He said "Hello"' },
      { name: 'Multi\nLine', desc: 'Simple' },
    ];
    const expected = 'name,desc\n"Alice, Bob","He said ""Hello"""\n"Multi\nLine",Simple';
    expect(toCSV(data)).toBe(expected);
  });

  it('should prevent Formula Injection by escaping fields starting with =, +, -, @', () => {
    const data = [
      { malicious: '=cmd|' },
      { malicious: '+cmd' },
      { malicious: '-cmd' },
      { malicious: '@cmd' },
    ];
    // Expect a single quote prepended
    const expected = 'malicious\n\'=cmd|\n\'+cmd\n\'-cmd\n\'@cmd';
    expect(toCSV(data)).toBe(expected);
  });

  it('should prevent Formula Injection with special chars also needing standard escaping', () => {
    const data = [
      { malicious: '=cmd, arg' }, // Needs quote for comma AND escape for formula
    ];
    // Start with =, so prepend '. Result: '=cmd, arg
    // Contains comma, so wrap in ". Result: "'=cmd, arg"
    const expected = 'malicious\n"\'=cmd, arg"';
    expect(toCSV(data)).toBe(expected);
  });

  it('should escape tab and carriage return to prevent DDE', () => {
    const data = [
        { malicious: '\tcmd' },
        { malicious: '\rcmd' }
    ];
    const expected = 'malicious\n\'\tcmd\n\'\rcmd';
    expect(toCSV(data)).toBe(expected);
  });

  it('should handle null and undefined', () => {
    const data = [
      { val: null },
      { val: undefined },
    ];
    const expected = 'val\n\n';
    expect(toCSV(data)).toBe(expected);
  });

  it('should format Dates', () => {
    const date = new Date('2023-01-01T00:00:00.000Z');
    const data = [{ val: date }];
    const expected = `val\n${date.toISOString()}`;
    expect(toCSV(data)).toBe(expected);
  });
});

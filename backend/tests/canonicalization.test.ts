/**
 * Cross-language canonicalization tests to ensure stable ordering (including non-ASCII keys).
 *
 * These tests assert the canonicalized string output produced by the backend's
 * JavaScript implementation matches the canonical form expected from the
 * Kotlin implementation (which sorts keys by their binary string order).
 */

import { describe, it, expect } from '@jest/globals';
import { canonicalize } from '../src/util/signature';

describe('Canonicalization', () => {
  it('deterministically sorts object keys including non-ASCII characters', () => {
    const obj = { 'å': 1, 'ä': 2, 'a': 3 };
    // Expected ordering by binary string comparison: 'a' < 'ä' < 'å'
    expect(canonicalize(obj)).toBe('{"a":3,"ä":2,"å":1}');
  });

  it('produces the expected canonical form for a complex object matching Kotlin output', () => {
    const data = {
      b: [1, 'x'],
      'åb': { 'ß': true, a: 'z' },
      'ā': null,
    };
    // Top-level key ordering: 'b' (0x62), 'åb' (0x00E5...), 'ā' (0x0101...)
    // Inner object 'åb' keys ordered: 'a' then 'ß'
    expect(canonicalize(data)).toBe('{"b":[1,"x"],"åb":{"a":"z","ß":true},"ā":null}');
  });

  it('is stable across repeated calls', () => {
    const data = { z: 1, 'å': 2, a: 3 };
    const first = canonicalize(data);
    const second = canonicalize(data);
    expect(first).toBe(second);
  });

  it('handles arrays and mixed types predictably', () => {
    const data = { arr: [null, undefined, "str", 5, { 'é': 1, e: 2 }] };
    // Note: undefined inside arrays becomes "undefined" according to canonicalize implementation.
    // Inner object keys should be ordered: 'e' then 'é'
    expect(canonicalize(data)).toBe('{"arr":[null,undefined,"str",5,{"e":2,"é":1}]}');
  });
});
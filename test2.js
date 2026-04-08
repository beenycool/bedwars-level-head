const assert = require('node:assert');

const str = 'foo\u2028bar';
assert.strictEqual(str.codePointAt(3), 0x2028, 'U+2028 LINE SEPARATOR must be preserved');
assert.strictEqual(str.length, 7);

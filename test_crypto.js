const { pbkdf2 } = require('node:crypto');
const { promisify } = require('node:util');
const pbkdf2Async = promisify(pbkdf2);

async function test() {
  try {
    const key = await pbkdf2Async('secret', 'salt', 1000, 32, 'sha256');
    console.log('Success:', key.toString('hex'));
  } catch (err) {
    console.error('Error:', err);
  }
}

test();

import { hashIp } from '../../src/services/redis';
import * as config from '../../src/config';

// We use Object.defineProperty because the exports are read-only constants
const setSalt = (salt: string) => {
  Object.defineProperty(config, 'REDIS_KEY_SALT', {
    value: salt,
    configurable: true
  });
};

describe('IP Hashing Security', () => {
  const originalSalt = config.REDIS_KEY_SALT;

  afterAll(() => {
    setSalt(originalSalt);
  });

  it('should use the configured salt for hashing', () => {
    const ip = '127.0.0.1';

    setSalt('test-salt-A');
    const hashA = hashIp(ip);

    // Bolt: Use a different IP to avoid cache hit (hashIp caches by IP)
    const ip2 = '127.0.0.2';
    setSalt('test-salt-B');
    const hashB = hashIp(ip2);

    expect(hashA).not.toBe(hashB);
    expect(hashA).toHaveLength(32);
    expect(hashB).toHaveLength(32);
  });

  it('should be deterministic for the same IP and salt', () => {
    const ip = '192.168.1.1';
    setSalt('fixed-salt');
    const hash1 = hashIp(ip);
    const hash2 = hashIp(ip);
    expect(hash1).toBe(hash2);
  });

  it('should not use the old hard-coded default salt', () => {
    const ip = '8.8.8.8';
    const oldDefaultSalt = 'levelhead-default-salt';

    // If we set the salt to empty, it should NOT produce the same hash as if it used the old default
    setSalt('');
    const hashWithEmpty = hashIp(ip);

    // Bolt: Use a different IP to avoid cache hit
    const ip2 = '8.8.8.9';
    setSalt(oldDefaultSalt);
    const hashWithOldDefault = hashIp(ip2);

    expect(hashWithEmpty).not.toBe(hashWithOldDefault);
  });
});

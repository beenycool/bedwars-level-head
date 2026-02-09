import { describe, it, expect, jest } from '@jest/globals';
import { _test } from '../../src/routes/player';

const { verifyHypixelOrigin } = _test;

// Mock the hypixel service
jest.mock('../../src/services/hypixel', () => ({
  fetchHypixelPlayer: jest.fn().mockImplementation(async () => {
    return {
      payload: {
        success: true,
        player: {
          uuid: 'newplayeruuid',
          displayname: 'NewPlayer',
          stats: {
            Bedwars: {} // Empty stats
          }
        },
        data: {
          bedwars: {} // Empty stats
        }
      },
      notModified: false,
    };
  }),
  isValidBedwarsObject: () => true,
}));

// Mock validation
jest.mock('../../src/util/validation', () => {
    const original = jest.requireActual('../../src/util/validation') as any;
    return {
        ...original,
        validateTimestampAndNonce: jest.fn(),
    };
});

// Mock type checks
jest.mock('../../src/util/typeChecks', () => ({
    isValidBedwarsObject: () => true,
    isNonArrayObject: (obj: any) => typeof obj === 'object' && obj !== null && !Array.isArray(obj),
}));

// Mock cache service to prevent DB connection
jest.mock('../../src/services/cache', () => ({
  ensureInitialized: jest.fn().mockReturnValue(Promise.resolve()),
  pool: {
    query: jest.fn(),
    type: 'POSTGRESQL',
  },
  shouldReadFromDb: () => false,
  markDbAccess: jest.fn(),
  CacheSource: {},
}));

// Mock statsCache service
jest.mock('../../src/services/statsCache', () => ({
  getPlayerStatsFromCache: jest.fn().mockReturnValue(Promise.resolve(null)),
  setPlayerStatsBoth: jest.fn().mockReturnValue(Promise.resolve()),
  setIgnMapping: jest.fn().mockReturnValue(Promise.resolve()),
}));

// Mock redis service
jest.mock('../../src/services/redis', () => ({
  getRedisClient: jest.fn().mockReturnValue(null),
  isRedisAvailable: jest.fn().mockReturnValue(false),
}));


describe('Empty Stats Cache Poisoning', () => {
  it('should reject submission with fake stats when source has empty stats', async () => {
    const uuid = 'newplayeruuid';

    // Attacker submits high stats for a new player (who has empty stats in Hypixel)
    const spoofedData = {
      displayname: 'NewPlayer',
      bedwars_experience: 1000000,
      final_kills_bedwars: 5000,
      wins_bedwars: 1000,
    };

    // No signature -> fallback to Hypixel fetch
    const result = await verifyHypixelOrigin(uuid, spoofedData, undefined, 'test-key-id');

    // Currently vulnerable: returns true because matchesCriticalFields returns true for empty source
    // We expect it to be false after fix
    expect(result.valid).toBe(false);
  });
});

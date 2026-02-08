import { describe, it, expect, jest } from '@jest/globals';
import { verifyHypixelOrigin } from '../../src/routes/player';

// Mock the hypixel service
jest.mock('../../src/services/hypixel', () => ({
  fetchHypixelPlayer: jest.fn().mockImplementation(async () => {
    return {
      payload: {
        success: true,
        player: {
          uuid: '069a79f444e94726a5befca90e38aaf5', // Notch
          displayname: 'Notch',
          stats: {
            Bedwars: {
              bedwars_experience: 1000,
              final_kills_bedwars: 10,
              final_deaths_bedwars: 5,
              wins_bedwars: 2,
            }
          }
        },
        data: {
          bedwars: {
            bedwars_experience: 1000,
            final_kills_bedwars: 10,
            final_deaths_bedwars: 5,
            wins_bedwars: 2,
          }
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


describe('IGN Spoofing Vulnerability', () => {
  it('should reject submission with fake displayname even if stats match', async () => {
    const uuid = '069a79f444e94726a5befca90e38aaf5';
    const fakeDisplayname = 'Technoblade';

    // Data matches critical stats but has fake displayname
    const spoofedData = {
      displayname: fakeDisplayname,
      bedwars_experience: 1000,
      final_kills_bedwars: 10,
      final_deaths_bedwars: 5,
      wins_bedwars: 2,
    };

    // No signature -> fallback to Hypixel fetch
    const result = await verifyHypixelOrigin(uuid, spoofedData, undefined, 'test-key-id');

    // Currently vulnerable: returns true because stats match
    // We expect it to be false after fix
    expect(result.valid).toBe(false);
    if (result.valid === false) {
        expect(result.error).toMatch(/Displayname mismatch/i);
    }
  });
});

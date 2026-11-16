
// Mock dependencies before importing the module under test
jest.mock('../../src/services/cache', () => ({
  pool: {
    query: jest.fn(),
  },
  ensureInitialized: jest.fn(),
}));

jest.mock('../../src/util/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// Also mock config just in case
jest.mock('../../src/config', () => ({
  HYPIXEL_API_KEY: 'test-key',
  HYPIXEL_API_BASE_URL: 'https://api.hypixel.net',
  HYPIXEL_TIMEOUT_MS: 5000,
  HYPIXEL_RETRY_DELAY_MIN_MS: 100,
  HYPIXEL_RETRY_DELAY_MAX_MS: 500,
  CB_FAILURE_THRESHOLD: 5,
  CB_RESET_TIMEOUT_MS: 30000,
  OUTBOUND_USER_AGENT: 'Levelhead/Test',
}));

import { extractMinimalStats, HypixelPlayerResponse } from '../../src/services/hypixel';

describe('extractMinimalStats Optimization', () => {
  it('should fallback to aggregation when Duels/SkyWars top-level stats are missing', () => {
    const payload: HypixelPlayerResponse = {
      success: true,
      player: {
        uuid: 'test-uuid-missing',
        displayname: 'MissingStatsPlayer',
        stats: {
          Bedwars: {},
          Duels: {
            wins_bridge: 10,
            losses_bridge: 5,
            kills_bridge: 20,
            deaths_bridge: 15,
            // wins/losses/kills/deaths are undefined
          },
          SkyWars: {
            wins_solo_normal: 5,
            losses_solo_normal: 2,
            kills_solo_normal: 10,
            deaths_solo_normal: 8,
            // wins/losses/kills/deaths are undefined
          },
        },
      },
    };

    const stats = extractMinimalStats(payload);

    expect(stats.duels_wins).toBe(10);
    expect(stats.duels_losses).toBe(5);
    expect(stats.duels_kills).toBe(20);
    expect(stats.duels_deaths).toBe(15);

    expect(stats.skywars_wins).toBe(5);
    expect(stats.skywars_losses).toBe(2);
    expect(stats.skywars_kills).toBe(10);
    expect(stats.skywars_deaths).toBe(8);
  });

  it('should use top-level stats and skip aggregation when they are 0', () => {
    const payload: HypixelPlayerResponse = {
      success: true,
      player: {
        uuid: 'test-uuid-zero',
        displayname: 'ZeroStatsPlayer',
        stats: {
          Bedwars: {},
          Duels: {
            wins: 0,
            losses: 0,
            kills: 0,
            deaths: 0,
            // These sub-stats should be ignored because top-level is 0 (and present)
            wins_bridge: 100,
            losses_bridge: 50,
          },
          SkyWars: {
            wins: 0,
            losses: 0,
            kills: 0,
            deaths: 0,
            // These sub-stats should be ignored
            wins_solo_normal: 50,
            losses_solo_normal: 20,
          },
        },
      },
    };

    const stats = extractMinimalStats(payload);

    // Should be 0, ignoring the sub-stats
    expect(stats.duels_wins).toBe(0);
    expect(stats.duels_losses).toBe(0);
    expect(stats.duels_kills).toBe(0);
    expect(stats.duels_deaths).toBe(0);

    expect(stats.skywars_wins).toBe(0);
    expect(stats.skywars_losses).toBe(0);
    expect(stats.skywars_kills).toBe(0);
    expect(stats.skywars_deaths).toBe(0);
  });

  it('should use top-level stats when they are non-zero', () => {
    const payload: HypixelPlayerResponse = {
      success: true,
      player: {
        uuid: 'test-uuid-normal',
        displayname: 'NormalPlayer',
        stats: {
          Bedwars: {},
          Duels: {
            wins: 123,
            losses: 45,
            kills: 67,
            deaths: 89,
            // Sub-stats shouldn't matter as we don't aggregate if top-level present
            wins_bridge: 10,
          },
          SkyWars: {
            wins: 321,
            losses: 54,
            kills: 76,
            deaths: 98,
          },
        },
      },
    };

    const stats = extractMinimalStats(payload);

    expect(stats.duels_wins).toBe(123);
    expect(stats.duels_losses).toBe(45);
    expect(stats.duels_kills).toBe(67);
    expect(stats.duels_deaths).toBe(89);

    expect(stats.skywars_wins).toBe(321);
    expect(stats.skywars_losses).toBe(54);
    expect(stats.skywars_kills).toBe(76);
    expect(stats.skywars_deaths).toBe(98);
  });

  it('reads lowercase skywars.experience like the mod parser', () => {
    const payload: HypixelPlayerResponse = {
      success: true,
      player: {
        uuid: 'test-uuid-skywars-experience',
        displayname: 'SkyWarsPlayer',
        stats: {
          SkyWars: {
            experience: 123_456,
          },
        },
      },
    };

    expect(extractMinimalStats(payload).skywars_experience).toBe(123_456);
  });

  it('prefers skywars_experience over the lowercase fallback', () => {
    const payload: HypixelPlayerResponse = {
      success: true,
      player: {
        uuid: 'test-uuid-skywars-precedence',
        displayname: 'SkyWarsPlayer',
        stats: {
          SkyWars: {
            skywars_experience: 999,
            experience: 123,
            Experience: 456,
          },
        },
      },
    };

    expect(extractMinimalStats(payload).skywars_experience).toBe(999);
  });

  it('passes the selected BedWars star cosmetic through', () => {
    const payload: HypixelPlayerResponse = {
      success: true,
      player: {
        uuid: 'test-uuid-custom-star',
        displayname: 'CustomStar',
        stats: {
          Bedwars: {
            bedwars_experience: 2882000,
            active_star: 'star_hollow',
          },
        },
      },
    };

    expect(extractMinimalStats(payload).bedwars_active_star).toBe('star_hollow');
  });

  it('omits a missing or non-string BedWars star cosmetic', () => {
    const payload: HypixelPlayerResponse = {
      success: true,
      player: {
        uuid: 'test-uuid-default-star',
        displayname: 'DefaultStar',
        stats: {
          Bedwars: {
            bedwars_experience: 1000,
            active_star: 42,
          },
        },
      },
    };

    expect(extractMinimalStats(payload).bedwars_active_star).toBeNull();
  });
});

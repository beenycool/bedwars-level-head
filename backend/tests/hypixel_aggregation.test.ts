// Mock hypixelTracker to prevent DB connection attempts
jest.mock('../src/services/hypixelTracker', () => ({
  recordHypixelApiCall: jest.fn(),
  getHypixelCallCount: jest.fn(),
}));

// Mock cache to prevent initialization
jest.mock('../src/services/cache', () => ({
  pool: {
    query: jest.fn(),
  },
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
}));

import { extractMinimalStats, HypixelPlayerResponse } from '../src/services/hypixel';

describe('extractMinimalStats Aggregation', () => {
  it('should correctly aggregate stats when top-level fields are missing', () => {
    const mockResponse: HypixelPlayerResponse = {
      success: true,
      player: {
        uuid: 'test-uuid',
        displayname: 'TestPlayer',
        stats: {
          Bedwars: {},
          Duels: {
            wins_mode_1: 10,
            wins_mode_2: 5,
            losses_mode_1: 2,
            kills_mode_1: 100,
            deaths_mode_1: 50,
            // Non-numeric fields should be ignored
            some_string: 'ignore me',
            some_object: {},
          },
          SkyWars: {
             wins_solo: 20,
             losses_solo: 10,
             kills_solo: 200,
             deaths_solo: 100,
          }
        }
      }
    };

    const stats = extractMinimalStats(mockResponse);

    // Duels
    // wins: 10 + 5 = 15
    expect(stats.duels_wins).toBe(15);
    // losses: 2
    expect(stats.duels_losses).toBe(2);
    // kills: 100
    expect(stats.duels_kills).toBe(100);
    // deaths: 50
    expect(stats.duels_deaths).toBe(50);

    // SkyWars
    expect(stats.skywars_wins).toBe(20);
    expect(stats.skywars_losses).toBe(10);
    expect(stats.skywars_kills).toBe(200);
    expect(stats.skywars_deaths).toBe(100);
  });

  it('should use top-level fields if present', () => {
    const mockResponse: HypixelPlayerResponse = {
      success: true,
      player: {
        uuid: 'test-uuid',
        displayname: 'TestPlayer',
        stats: {
          Bedwars: {},
          Duels: {
            wins: 1000,
            losses: 500,
            kills: 5000,
            deaths: 2000,
            // These should be ignored because top-level fields are present
            wins_mode_1: 10,
          },
          SkyWars: {}
        }
      }
    };

    const stats = extractMinimalStats(mockResponse);

    expect(stats.duels_wins).toBe(1000);
    expect(stats.duels_losses).toBe(500);
    expect(stats.duels_kills).toBe(5000);
    expect(stats.duels_deaths).toBe(2000);
  });
});

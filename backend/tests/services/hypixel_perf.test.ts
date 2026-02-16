import axios from 'axios';

// Define mockGet outside to be accessible
const mockGet = jest.fn();

// Mock dependencies before import
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: mockGet,
  })),
  isAxiosError: jest.fn(() => false),
}));

jest.mock('../../src/services/hypixelTracker', () => ({
  recordHypixelApiCall: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('cacheable-lookup', () => {
  return jest.fn().mockImplementation(() => ({
    install: jest.fn(),
  }));
});

jest.mock('node:https', () => ({
  Agent: jest.fn(),
}));

// Import after mocking
import { fetchHypixelPlayer } from '../../src/services/hypixel';

describe('fetchHypixelPlayer Performance Optimization', () => {
  it('correctly shapes the payload without losing data', async () => {
    const hugeStats: Record<string, any> = {};
    for (let i = 0; i < 1000; i++) {
      hugeStats[`stat_${i}`] = i;
    }
    hugeStats.final_kills_bedwars = 10;
    hugeStats.final_deaths_bedwars = 2;
    hugeStats.bedwars_experience = 5000;
    hugeStats.winstreak = 5;

    const mockResponse = {
      success: true,
      player: {
        uuid: 'test-uuid',
        displayname: 'TestPlayer',
        stats: {
          Bedwars: hugeStats,
          Duels: {},
          SkyWars: {},
        },
      },
    };

    mockGet.mockResolvedValue({
      status: 200,
      headers: {},
      data: mockResponse,
    });

    const result = await fetchHypixelPlayer('test-uuid');

    expect(result.payload).toBeDefined();
    expect(result.payload?.data?.bedwars).toBeDefined();

    // Verify critical fields
    expect(result.payload?.data?.bedwars?.final_kills_bedwars).toBe(10);
    expect((result.payload?.data?.bedwars as any).fkdr).toBe(5);
    expect((result.payload?.data?.bedwars as any).winstreak).toBe(5);
    expect((result.payload?.data?.bedwars as any).bedwars_experience).toBe(5000);

    // Verify random field from huge payload to ensure no data loss
    expect(result.payload?.data?.bedwars?.stat_500).toBe(500);

    // Verify structure
    // In optimized version, these should be reference equal
    // In unoptimized version, they are structurally equal but distinct objects (shallow copy)
    // We check structural equality here which covers both cases
    expect(result.payload?.bedwars).toEqual(result.payload?.data?.bedwars);
    expect(result.payload?.player?.stats?.Bedwars).toEqual(result.payload?.data?.bedwars);
  });
});

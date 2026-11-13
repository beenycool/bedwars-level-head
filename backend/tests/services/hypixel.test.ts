import { type HypixelPlayerResponse, shapePayload } from '../../src/services/hypixel';

// Mock dependencies before importing hypixel service to prevent top-level initialization
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  })),
  isAxiosError: jest.fn(),
}));
jest.mock('node:https', () => ({
  Agent: jest.fn(),
}));
jest.mock('cacheable-lookup', () => jest.fn().mockImplementation(() => ({
  install: jest.fn(),
})));

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

describe('shapePayload mutation', () => {
  it('should not mutate the input response object', () => {
    const response: HypixelPlayerResponse = {
      success: true,
      player: {
        uuid: 'test-uuid',
        displayname: 'TestPlayer',
        stats: {
          Bedwars: {
            Experience: 100,
            final_kills_bedwars: 10,
            final_deaths_bedwars: 2,
            winstreak: 5,
          },
          Duels: {},
          SkyWars: {},
        },
      },
    };

    // Deep copy to compare later
    const originalBedwarsStats = JSON.parse(JSON.stringify(response.player?.stats?.Bedwars ?? {}));

    shapePayload(response);

    // Verify it was NOT mutated
    expect(response.player!.stats!.Bedwars).toEqual(originalBedwarsStats);
    // Specifically check for keys that are added during shaping
    expect(response.player!.stats!.Bedwars).not.toHaveProperty('fkdr');
    expect(response.player!.stats!.Bedwars).not.toHaveProperty('bedwars_experience');
  });

  it('should not mutate the original response object', () => {
    const originalBedwarsStats = {
      Experience: 1000,
      final_kills_bedwars: 10,
      final_deaths_bedwars: 5,
    };

    const originalResponse = {
      success: true,
      player: {
        uuid: '123',
        displayname: 'TestPlayer',
        stats: {
          Bedwars: originalBedwarsStats,
          Duels: {},
          SkyWars: {},
        },
      },
    };

    // Deep clone for comparison
    const clonedOriginal = JSON.parse(JSON.stringify(originalResponse));

    shapePayload(originalResponse);

    // If it mutates, originalResponse will be different from clonedOriginal
    // Specifically, Bedwars stats will have new fields like fkdr, bedwars_experience
    expect(originalResponse).toEqual(clonedOriginal);
    expect(originalResponse.player.stats.Bedwars).not.toHaveProperty('fkdr');
  });
});

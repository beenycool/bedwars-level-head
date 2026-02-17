import axios from 'axios';
import https from 'node:https';

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
jest.mock('../../src/services/hypixelTracker.ts', () => ({
  recordHypixelApiCall: jest.fn().mockResolvedValue(undefined),
}));

import { shapePayload } from '../../src/services/hypixel';

describe('shapePayload mutation', () => {
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

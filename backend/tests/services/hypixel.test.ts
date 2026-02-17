import { type HypixelPlayerResponse, shapePayload } from '../../src/services/hypixel';

jest.mock('../../src/services/hypixelTracker', () => ({
  recordHypixelApiCall: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('cacheable-lookup', () => {
  return jest.fn().mockImplementation(() => ({
    install: jest.fn(),
  }));
});

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
    expect(response.player.stats.Bedwars).toEqual(originalBedwarsStats);
    // Specifically check for keys that are added during shaping
    expect(response.player.stats.Bedwars).not.toHaveProperty('fkdr');
    expect(response.player.stats.Bedwars).not.toHaveProperty('bedwars_experience');
  });
});

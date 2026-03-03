import { resolvePlayer, ResolvedPlayer, clearInMemoryPlayerCache } from '../../src/services/player';
import * as hypixelService from '../../src/services/hypixel';
import * as mojangService from '../../src/services/mojang';
import * as statsCache from '../../src/services/statsCache';

// Mock dependencies
jest.mock('../../src/services/hypixel');
jest.mock('../../src/services/mojang');
jest.mock('../../src/services/statsCache');
jest.mock('../../src/services/cache', () => ({
  ensureInitialized: jest.fn(),
}));
jest.mock('../../src/services/metrics', () => ({
  recordCacheMiss: jest.fn(),
  recordCacheRefresh: jest.fn(),
  recordCacheSourceHit: jest.fn(),
}));

describe('resolvePlayer optimization', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    clearInMemoryPlayerCache();
    (statsCache.getManyPlayerStatsFromCacheWithSWR as jest.Mock).mockResolvedValue(new Map());
    (statsCache.getPlayerStatsFromCacheWithSWR as jest.Mock).mockResolvedValue(null);
    (statsCache.getIgnMapping as jest.Mock).mockResolvedValue(null);
    (statsCache.setPlayerStatsBoth as jest.Mock).mockResolvedValue(undefined);
    (statsCache.setPlayerStatsL1 as jest.Mock).mockResolvedValue(undefined);
    (statsCache.setIgnMapping as jest.Mock).mockResolvedValue(undefined);
  });

  const mockStats = {
    displayname: 'TestPlayer',
    bedwars_final_kills: 10,
    bedwars_final_deaths: 5,
    duels_wins: 0,
    duels_losses: 0,
    duels_kills: 0,
    duels_deaths: 0,
    skywars_wins: 0,
    skywars_losses: 0,
    skywars_kills: 0,
    skywars_deaths: 0,
    bedwars_experience: 0,
    skywars_experience: 0,
  };

  it('should resolve a valid undashed UUID', async () => {
    const uuid = '123456781234123412341234567890ab';
    (hypixelService.fetchHypixelPlayer as jest.Mock).mockResolvedValue({
      payload: { player: { displayname: 'TestPlayer' } },
      etag: 'tag',
      lastModified: 12345,
    });
    (hypixelService.extractMinimalStats as jest.Mock).mockReturnValue(mockStats);
    (statsCache.fetchWithDedupe as jest.Mock).mockResolvedValue({ stats: mockStats, etag: 'tag', lastModified: 12345 });

    const result = await resolvePlayer(uuid);

    expect(result.uuid).toBe(uuid);
    expect(result.lookupType).toBe('uuid');
    expect(statsCache.fetchWithDedupe).toHaveBeenCalledWith(uuid, undefined);
  });

  it('should resolve a valid dashed UUID by stripping dashes', async () => {
    const dashed = '12345678-1234-1234-1234-1234567890ab';
    const undashed = '123456781234123412341234567890ab';

    (statsCache.fetchWithDedupe as jest.Mock).mockResolvedValue({ stats: mockStats, etag: 'tag', lastModified: 12345 });

    const result = await resolvePlayer(dashed);

    expect(result.uuid).toBe(undashed);
    expect(result.lookupType).toBe('uuid');
    expect(statsCache.fetchWithDedupe).toHaveBeenCalledWith(undashed, undefined);
  });

  it('should resolve a valid IGN', async () => {
    const ign = 'Technoblade';
    const uuid = '123456781234123412341234567890ab';

    (mojangService.lookupProfileByUsername as jest.Mock).mockResolvedValue({ id: uuid, name: 'Technoblade' });
    (statsCache.fetchWithDedupe as jest.Mock).mockResolvedValue({ stats: mockStats, etag: 'tag', lastModified: 12345 });

    const result = await resolvePlayer(ign);

    expect(result.lookupType).toBe('ign');
    expect(result.lookupValue).toBe(ign.toLowerCase());
    expect(result.uuid).toBe(uuid);
  });

  it('should reject invalid UUID format (invalid characters)', async () => {
    const invalidUuid = '123456781234123412341234567890az'; // z is invalid hex
    await expect(resolvePlayer(invalidUuid)).rejects.toThrow('Identifier must be a valid UUID');
  });

  it('should reject dashed UUID with invalid length', async () => {
    const invalidDashed = '12345678-1234-1234-1234-1234567890abc'; // too long
    await expect(resolvePlayer(invalidDashed)).rejects.toThrow("Identifier must be a valid UUID (no dashes) or Minecraft username.");
  });

  it('should reject IGN that is too long', async () => {
    const longIgn = 'ThisIgnIsWayTooLongForMinecraft';
    await expect(resolvePlayer(longIgn)).rejects.toThrow("Identifier must be a valid UUID (no dashes) or Minecraft username.");
  });

  it('should reject identifier that exceeds 64 characters to prevent DoS', async () => {
    const hugeIgn = 'A'.repeat(65);
    await expect(resolvePlayer(hugeIgn)).rejects.toThrow("Identifier must be 64 characters or less.");
  });

  it('should handle misplaced dashes if they result in valid UUID (optimization check)', async () => {
    // Original behavior: strict dashedUuidRegex would reject this.
    // Optimized behavior: strips dashes, checks if valid UUID.
    // If we want to maintain strictness, this test should expect failure.
    // If we relax it, it should pass.
    // Bolt decision: Relaxing is acceptable and even robust.

    const misplacedDashes = '123456781234123412341234-567890ab-'; // Length 36, but dashes at end
    // stripping dashes -> 34 chars -> not 32. -> fails uuidRegex.

    await expect(resolvePlayer(misplacedDashes)).rejects.toThrow('Identifier must be a valid UUID');
  });

  it('should reject misplaced dashes resulting in 32 chars', async () => {
      // '12345678-1234-1234-1234-1234567890ab' is valid.
      // '123456781234123412341234567890ab----' (32 hex + 4 dashes)
      const weird = '123456781234123412341234567890ab----';

      // With our new length check, the fast dash-stripping logic expects specific dashes at indices 8, 13, 18, 23.
      // This weird input doesn't have dashes there, so it isn't stripped.
      // Length is 36, and it doesn't match uuidRegex.
      // It also doesn't match ignRegex.

      (statsCache.fetchWithDedupe as jest.Mock).mockResolvedValue({ stats: mockStats, etag: 'tag', lastModified: 12345 });

      await expect(resolvePlayer(weird)).rejects.toThrow('Identifier must be a valid UUID (no dashes) or Minecraft username.');
  });
});

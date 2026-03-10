import { clearInMemoryPlayerCache, resolvePlayer } from '../../src/services/player';
import { fetchHypixelPlayer, extractMinimalStats } from '../../src/services/hypixel';
import { getPlayerStatsFromCache, setPlayerStatsBoth } from '../../src/services/statsCache';
import { DatabaseType } from '../../src/services/database/adapter';
import * as statsCache from '../../src/services/statsCache';

// Mock dependencies
jest.mock('../../src/services/database/db', () => {
  const { DatabaseType } = require('../../src/services/database/adapter');
  return {
    db: {
      selectFrom: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      executeTakeFirst: jest.fn(),
      deleteFrom: jest.fn().mockReturnThis(),
      execute: jest.fn(),
      insertInto: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
    },
    dbType: DatabaseType.POSTGRESQL
  };
});

jest.mock('../../src/services/cache', () => ({
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
  shouldReadFromDb: jest.fn().mockReturnValue(true),
  markDbAccess: jest.fn(),
  pool: { type: 'POSTGRESQL', query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }
}));

jest.mock('../../src/services/hypixel', () => ({
  fetchHypixelPlayer: jest.fn(),
  extractMinimalStats: jest.fn(),
}));

jest.mock('../../src/services/statsCache', () => ({
  ...jest.requireActual('../../src/services/statsCache'),
  getPlayerStatsFromCache: jest.fn(),
  setPlayerStatsBoth: jest.fn().mockResolvedValue(undefined),
  getManyPlayerStatsFromCacheWithSWR: jest.fn().mockResolvedValue(new Map()),
  getPlayerStatsFromCacheWithSWR: jest.fn().mockResolvedValue(null),
  setIgnMapping: jest.fn().mockResolvedValue(undefined),
  getIgnMapping: jest.fn().mockResolvedValue(null),
  fetchWithDedupe: jest.fn()
}));

jest.mock('../../src/services/mojang', () => ({
  lookupProfileByUsername: jest.fn().mockResolvedValue({ id: '530fa96a-303d-4219-9b5a-329d493a5573', name: 'TestPlayer' })
}));

describe('Player Service Optimization', () => {
  const mockStats = {
    displayname: 'TestPlayer',
    bedwars_experience: 5000,
    bedwars_final_kills: 100,
    bedwars_final_deaths: 50,
    duels_wins: 10,
    duels_losses: 5,
    duels_kills: 20,
    duels_deaths: 10,
    skywars_experience: 1000,
    skywars_wins: 5,
    skywars_losses: 2,
    skywars_kills: 15,
    skywars_deaths: 5,
  };

  const mockResolved = {
    stats: mockStats,
    etag: 'test-etag',
    lastModified: Date.now()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clearInMemoryPlayerCache(); // Clear in-memory cache before each test

    const statsCache = require('../../src/services/statsCache');
    (statsCache.fetchWithDedupe as jest.Mock).mockResolvedValue(mockResolved);
    (extractMinimalStats as jest.Mock).mockReturnValue(mockStats);
  });

  it('should efficiently resolve player without regex overhead for clean UUIDs', async () => {
    const uuid = '530fa96a303d42199b5a329d493a5573';
    (getPlayerStatsFromCache as jest.Mock).mockResolvedValue(null);
    const statsCache = require('../../src/services/statsCache');

    const result = await resolvePlayer(uuid);

    expect(result.uuid).toBe(uuid);
    expect(statsCache.fetchWithDedupe).toHaveBeenCalledWith(uuid, undefined);
  });

  it('should resolve player using IGN', async () => {
    const ign = 'TestPlayer';
    (getPlayerStatsFromCache as jest.Mock).mockResolvedValue(null);
    const statsCache = require('../../src/services/statsCache');

    const result = await resolvePlayer(ign);

    expect(result.lookupType).toBe('ign');
    expect(result.lookupValue).toBe('testplayer');
    expect(statsCache.fetchWithDedupe).toHaveBeenCalledWith('530fa96a303d42199b5a329d493a5573', undefined);
  });

  it('should normalize dashed UUIDs', async () => {
    const uuidWithDashes = '530fa96a-303d-4219-9b5a-329d493a5573';
    (getPlayerStatsFromCache as jest.Mock).mockResolvedValue(null);
    const statsCache = require('../../src/services/statsCache');

    const result = await resolvePlayer(uuidWithDashes);

    expect(result.uuid).toBe('530fa96a303d42199b5a329d493a5573');
    expect(statsCache.fetchWithDedupe).toHaveBeenCalledWith('530fa96a303d42199b5a329d493a5573', undefined);
  });

  it('should return cached player and not fetch if SWR cache is fresh', async () => {
    const uuid = '530fa96a303d42199b5a329d493a5573';

    const { getPlayerStatsFromCacheWithSWR } = require('../../src/services/statsCache');
    getPlayerStatsFromCacheWithSWR.mockResolvedValueOnce({
      value: mockStats,
      etag: 'cached-etag',
      lastModified: Date.now() - 1000,
      expiresAt: Date.now() + 10000,
      cachedAt: Date.now() - 1000,
      isStale: false,
      staleAgeMs: 0
    });

    const statsCache = require('../../src/services/statsCache');

    const result = await resolvePlayer(uuid);

    expect(result.source).toBe('cache');
    expect(result.uuid).toBe(uuid);
    expect(statsCache.fetchWithDedupe).not.toHaveBeenCalled();
  });

  it('should mark UUID lookups without a usable displayname as nicked', async () => {
    const uuid = '530fa96a303d42199b5a329d493a5573';
    const statsWithoutDisplayname = {
      ...mockStats,
      displayname: null,
    };
    const statsCache = require('../../src/services/statsCache');

    (statsCache.fetchWithDedupe as jest.Mock).mockResolvedValueOnce({
      stats: statsWithoutDisplayname,
      etag: 'nicked-etag',
      lastModified: Date.now(),
    });

    const result = await resolvePlayer(uuid);

    expect(result.nicked).toBe(true);
    expect(result.payload.displayname).toBe('(nicked)');
    expect(statsCache.setPlayerStatsBoth).toHaveBeenCalledWith(
      `player:${uuid}`,
      expect.objectContaining({ displayname: '(nicked)' }),
      expect.any(Object),
    );
    expect(statsCache.setIgnMapping).not.toHaveBeenCalledWith('(nicked)', uuid, false);
  });

  it('should treat cached UUID entries without a usable displayname as nicked', async () => {
    const uuid = '530fa96a303d42199b5a329d493a5573';
    const statsWithoutDisplayname = {
      ...mockStats,
      displayname: null,
    };

    const { getPlayerStatsFromCacheWithSWR } = require('../../src/services/statsCache');
    getPlayerStatsFromCacheWithSWR.mockResolvedValueOnce({
      value: statsWithoutDisplayname,
      etag: 'cached-nicked-etag',
      lastModified: Date.now() - 1000,
      expiresAt: Date.now() + 10000,
      cachedAt: Date.now() - 1000,
      isStale: false,
      staleAgeMs: 0,
    });

    const result = await resolvePlayer(uuid);

    expect(result.source).toBe('cache');
    expect(result.nicked).toBe(true);
    expect(result.payload.displayname).toBe('(nicked)');
  });

  it('should throw error when fetchWithDedupe fails on network request', async () => {
    const uuid = '530fa96a303d42199b5a329d493a5573';
    (getPlayerStatsFromCache as jest.Mock).mockResolvedValue(null);

    const mockError = new Error('Network Failure');
    const statsCache = require('../../src/services/statsCache');
    (statsCache.fetchWithDedupe as jest.Mock).mockRejectedValueOnce(mockError);

    await expect(resolvePlayer(uuid)).rejects.toThrow('Network Failure');
  });

  it('should reject invalid UUID format (invalid characters)', async () => {
    const invalidUuid = '123456781234123412341234567890az';
    await expect(resolvePlayer(invalidUuid)).rejects.toThrow('Identifier must be a valid UUID (no dashes) or Minecraft username.');
  });

  it('should reject IGN that is too long', async () => {
    const longIgn = 'ThisIgnIsWayTooLongForMinecraft';
    await expect(resolvePlayer(longIgn)).rejects.toThrow("Identifier must be a valid UUID (no dashes) or Minecraft username.");
  });

  it('should reject identifier that exceeds 64 characters to prevent DoS', async () => {
    const hugeIgn = 'A'.repeat(65);
    await expect(resolvePlayer(hugeIgn)).rejects.toThrow("64 characters or less");
  });

  it('should handle misplaced dashes if they result in valid UUID (optimization check)', async () => {
    const misplacedDashes = '123456781234123412341234-567890ab-'; // Length 36, but dashes at end
    await expect(resolvePlayer(misplacedDashes)).rejects.toThrow('Identifier must be a valid UUID');
  });

  it('should reject misplaced dashes resulting in 32 chars', async () => {
    const weird = '123456781234123412341234567890ab----';
    const statsCache = require('../../src/services/statsCache');
    (statsCache.fetchWithDedupe as jest.Mock).mockResolvedValue({ stats: mockStats, etag: 'tag', lastModified: 12345 });

    // With our new length check, the fast dash-stripping logic expects specific dashes at indices 8, 13, 18, 23.
    // This weird input doesn't have dashes there, so it isn't stripped.
    // Length is 36, and it doesn't match uuidRegex.
    // It also doesn't match ignRegex.

    await expect(resolvePlayer(weird)).rejects.toThrow('Identifier must be a valid UUID (no dashes) or Minecraft username.');
  });
});

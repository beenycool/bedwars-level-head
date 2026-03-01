import { clearInMemoryPlayerCache, resolvePlayer } from '../../src/services/player';
import { fetchHypixelPlayer, extractMinimalStats } from '../../src/services/hypixel';
import { getPlayerStatsFromCache, setPlayerStatsBoth } from '../../src/services/statsCache';
import { DatabaseType } from '../../src/services/database/adapter';

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
  getIgnMapping: jest.fn().mockResolvedValue(null)
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
    payload: { player: { displayname: 'TestPlayer', stats: { Bedwars: {} } } },
    etag: 'test-etag',
    lastModified: Date.now(),
    notModified: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clearInMemoryPlayerCache(); // Clear in-memory cache before each test
    (fetchHypixelPlayer as jest.Mock).mockResolvedValue(mockResolved);
    (extractMinimalStats as jest.Mock).mockReturnValue(mockStats);
  });

  it('should efficiently resolve player without regex overhead for clean UUIDs', async () => {
    const uuid = '530fa96a303d42199b5a329d493a5573';
    (getPlayerStatsFromCache as jest.Mock).mockResolvedValue(null);

    const result = await resolvePlayer(uuid);

    expect(result.uuid).toBe(uuid);
    expect(fetchHypixelPlayer).toHaveBeenCalledWith(uuid, undefined);
  });

  it('should resolve player using IGN', async () => {
    const ign = 'TestPlayer';
    (getPlayerStatsFromCache as jest.Mock).mockResolvedValue(null);

    const result = await resolvePlayer(ign);

    expect(result.lookupType).toBe('ign');
    expect(result.lookupValue).toBe('testplayer');
    expect(fetchHypixelPlayer).toHaveBeenCalledWith('530fa96a303d42199b5a329d493a5573', undefined);
  });

  it('should normalize dashed UUIDs', async () => {
    const uuidWithDashes = '530fa96a-303d-4219-9b5a-329d493a5573';
    (getPlayerStatsFromCache as jest.Mock).mockResolvedValue(null);

    const result = await resolvePlayer(uuidWithDashes);

    expect(result.uuid).toBe('530fa96a303d42199b5a329d493a5573');
    expect(fetchHypixelPlayer).toHaveBeenCalledWith('530fa96a303d42199b5a329d493a5573', undefined);
  });

  it('should return cached player and not fetch if SWR cache is fresh', async () => {
    const uuid = '530fa96a303d42199b5a329d493a5573';

    // Mock getPlayerStatsFromCacheWithSWR to return a fresh cache hit
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

    const result = await resolvePlayer(uuid);

    expect(result.source).toBe('cache');
    expect(result.uuid).toBe(uuid);
    expect(fetchHypixelPlayer).not.toHaveBeenCalled();
  });

  it('should throw error when fetchHypixelPlayer fails on network request', async () => {
    const uuid = '530fa96a303d42199b5a329d493a5573';
    (getPlayerStatsFromCache as jest.Mock).mockResolvedValue(null);

    const mockError = new Error('Network Failure');
    (fetchHypixelPlayer as jest.Mock).mockRejectedValueOnce(mockError);

    await expect(resolvePlayer(uuid)).rejects.toThrow('Network Failure');
  });
});

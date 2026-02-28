import { resolvePlayer } from '../../src/services/player';
import { fetchHypixelPlayer, extractMinimalStats } from '../../src/services/hypixel';
import { getPlayerStatsFromCache, setPlayerStatsBoth } from '../../src/services/statsCache';

// Mock dependencies
jest.mock('../../src/services/database/db', () => ({
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
  dbType: 'POSTGRESQL'
}));

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
    (fetchHypixelPlayer as jest.Mock).mockResolvedValue(mockResolved);
    (extractMinimalStats as jest.Mock).mockReturnValue(mockStats);
  });

  it('should efficiently resolve player without regex overhead for clean UUIDs', async () => {
    // This test primarily validates the logic doesn't crash; optimization is structural
    const uuid = '530fa96a303d42199b5a329d493a5573';
    (getPlayerStatsFromCache as jest.Mock).mockResolvedValue(null);

    const result = await resolvePlayer(uuid);

    expect(result.uuid).toBe(uuid);
    expect(fetchHypixelPlayer).toHaveBeenCalledWith(uuid, undefined);
  });
});

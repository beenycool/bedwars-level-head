jest.mock('../../src/services/statsCache', () => ({
  buildPlayerCacheKey: (uuid: string) => `player:${uuid}`,
  getManyPlayerStats: jest.fn(),
  getPlayerStats: jest.fn(),
  setPlayerStats: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/hypixel', () => ({
  fetchHypixelPlayer: jest.fn(),
  extractMinimalStats: jest.fn(),
}));

import {
  clearInMemoryPlayerCache,
  resolvePlayer,
  warmupPlayerCache,
} from '../../src/services/player';
import {
  getManyPlayerStats,
  getPlayerStats,
  setPlayerStats,
} from '../../src/services/statsCache';
import { extractMinimalStats, fetchHypixelPlayer } from '../../src/services/hypixel';
import type { CachedPlayerStats } from '../../src/services/statsCache';
import type { MinimalPlayerStats } from '../../src/services/hypixel';

const UUID = 'abcdef0123456789abcdef0123456789';
const DASHED = 'ABCDEF01-2345-6789-ABCD-EF0123456789';

const payload: MinimalPlayerStats = {
  displayname: 'Tester',
  bedwars_experience: 1_000,
  bedwars_active_star: null,
  bedwars_final_kills: 1,
  bedwars_final_deaths: 1,
  duels_wins: 0,
  duels_losses: 0,
  duels_kills: 0,
  duels_deaths: 0,
  skywars_experience: null,
  skywars_wins: 0,
  skywars_losses: 0,
  skywars_kills: 0,
  skywars_deaths: 0,
};

const cachedEntry: CachedPlayerStats = {
  value: payload,
  expiresAt: Date.now() + 60_000,
  etag: null,
  lastModified: null,
};

describe('per-request warmup misses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearInMemoryPlayerCache();
    (extractMinimalStats as jest.Mock).mockReturnValue(payload);
    (fetchHypixelPlayer as jest.Mock).mockResolvedValue({
      payload: { success: true },
      etag: null,
      lastModified: null,
    });
    (setPlayerStats as jest.Mock).mockResolvedValue(undefined);
  });

  it('returns only SQL misses and lets that request skip one SELECT', async () => {
    (getManyPlayerStats as jest.Mock).mockResolvedValue(new Map());

    const misses = await warmupPlayerCache([DASHED, UUID.toUpperCase()]);

    expect(getManyPlayerStats).toHaveBeenCalledWith([`player:${UUID}`]);
    expect([...misses]).toEqual([UUID]);

    const result = await resolvePlayer(UUID, misses);

    expect(getPlayerStats).not.toHaveBeenCalled();
    expect(fetchHypixelPlayer).toHaveBeenCalledWith(UUID);
    expect(result.source).toBe('network');
    // The caller's set is consumed as each warmed UUID is resolved.
    expect(misses.size).toBe(0);
  });

  it('does not leak a warmup miss into a different request', async () => {
    (getManyPlayerStats as jest.Mock).mockResolvedValue(new Map());

    await warmupPlayerCache([UUID]);
    (getPlayerStats as jest.Mock).mockResolvedValue(cachedEntry);

    // A resolve that did not receive this warmup set must still consult SQL.
    const result = await resolvePlayer(UUID);

    expect(getPlayerStats).toHaveBeenCalledWith(`player:${UUID}`);
    expect(fetchHypixelPlayer).not.toHaveBeenCalled();
    expect(result.source).toBe('cache');
  });

  it('memoizes warmup hits without reporting them as misses', async () => {
    (getManyPlayerStats as jest.Mock).mockResolvedValue(new Map([[`player:${UUID}`, cachedEntry]]));

    const misses = await warmupPlayerCache([UUID]);
    const result = await resolvePlayer(UUID);

    expect(misses.size).toBe(0);
    expect(getPlayerStats).not.toHaveBeenCalled();
    expect(result.source).toBe('cache');
  });

  it('rejects usernames but accepts dashed UUIDs', async () => {
    await expect(resolvePlayer('Notch')).rejects.toMatchObject({ status: 400 });

    (getPlayerStats as jest.Mock).mockResolvedValue(cachedEntry);
    const result = await resolvePlayer(DASHED);

    expect(result.source).toBe('cache');
    expect(getPlayerStats).toHaveBeenCalledWith(`player:${UUID}`);
  });
});

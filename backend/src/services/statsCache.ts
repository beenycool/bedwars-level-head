import {
  IGN_L2_TTL_MS, PLAYER_L1_INFO_REFRESH_MS, PLAYER_L1_SAFETY_FACTOR, PLAYER_L1_TARGET_UTILIZATION, PLAYER_L1_TTL_FALLBACK_MS,
  PLAYER_L1_TTL_MAX_MS, PLAYER_L1_TTL_MIN_MS, PLAYER_L2_TTL_MS, REDIS_CACHE_MAX_BYTES, SWR_ENABLED, SWR_STALE_TTL_MS,
} from '../config';
import { CacheEntry, CacheMetadata, CacheSource, ensureInitialized, markDbAccess, pool, shouldReadFromDb } from './cache';
import { DatabaseType } from './database/adapter';
import { recordCacheHit, recordCacheMiss, recordCacheTierHit, recordCacheTierMiss, recordCacheSourceHit, recordCacheRefresh } from './metrics';
import { fetchHypixelPlayer, HypixelFetchOptions, MinimalPlayerStats, extractMinimalStats } from './hypixel';
import { getRedisClient, isRedisAvailable } from './redis';

const fLocks: Map<string, Promise<any>> = new Map(); const bgLocks: Map<string, Promise<void>> = new Map();
const P_KEY = 'player:'; const IGN_KEY = 'ignmap:';

export async function fetchWithDedupe(uuid: string, options?: HypixelFetchOptions): Promise<any> {
  const norm = uuid.toLowerCase(); const ex = fLocks.get(norm); if (ex) return await ex;
  const prom: Promise<any> = (async (): Promise<any> => {
    const res = await fetchHypixelPlayer(norm, options);
    if (res.notModified) throw new Error('Unexpected 304'); if (!res.payload) throw new Error('Empty payload');
    return { stats: extractMinimalStats(res.payload), etag: res.etag, lastModified: res.lastModified };
  })();
  fLocks.set(norm, prom); try { return await prom; } finally { fLocks.delete(norm); }
}

interface CacheRow { payload: unknown; expires_at: number | string; cached_at?: number | string | null; etag: string | null; last_modified: number | string | null; source: string | null; }
interface IgnRow { uuid: string | null; nicked: boolean | number; expires_at: number | string; }

let lMem: any = null; let cAdpTtl = PLAYER_L1_TTL_FALLBACK_MS;
export function buildPlayerCacheKey(uuid: string): string { return `${P_KEY}${uuid}`; }
export function buildIgnMappingKey(ign: string): string { return `${IGN_KEY}${ign}`; }

function parseRedisMem(info: string, ts: number): any {
  const uMatch = info.match(/used_memory:(\d+)/); if (!uMatch) return null;
  const mMatch = info.match(/maxmemory:(\d+)/); const eMatch = info.match(/evicted_keys:(\d+)/);
  const uB = Number.parseInt(uMatch[1], 10); const mB = mMatch ? Number.parseInt(mMatch[1], 10) : REDIS_CACHE_MAX_BYTES;
  const eK = eMatch ? Number.parseInt(eMatch[1], 10) : 0;
  return { usedBytes: uB, maxBytes: mB > 0 ? mB : REDIS_CACHE_MAX_BYTES, evictedKeys: eK, sampledAt: ts };
}

function getAdpTtl(): number { return cAdpTtl; }

async function refAdpTtl(): Promise<void> {
  const cli = getRedisClient(); if (!cli || cli.status !== 'ready') { cAdpTtl = PLAYER_L1_TTL_FALLBACK_MS; return; }
  try {
    const info = await cli.info('memory'); const sample = parseRedisMem(info, Date.now()); if (!sample) return;
    let ttl = PLAYER_L1_TTL_FALLBACK_MS;
    if (sample.maxBytes > 0) {
      const target = sample.maxBytes * PLAYER_L1_TARGET_UTILIZATION; const head = target - sample.usedBytes;
      if (head <= 0) ttl = PLAYER_L1_TTL_MIN_MS;
      else if (lMem) {
        const elap = (sample.sampledAt - lMem.sampledAt) / 1000; const del = sample.usedBytes - lMem.usedBytes;
        if (elap > 0 && del > 0) ttl = (head / (del / elap)) * 1000 * PLAYER_L1_SAFETY_FACTOR;
      }
    }
    ttl = Math.min(Math.max(Math.floor(ttl), PLAYER_L1_TTL_MIN_MS), PLAYER_L1_TTL_MAX_MS);
    if (lMem && sample.evictedKeys > lMem.evictedKeys) ttl = Math.max(PLAYER_L1_TTL_MIN_MS, Math.floor(ttl * 0.5));
    lMem = sample; cAdpTtl = ttl;
  } catch (e) { cAdpTtl = PLAYER_L1_TTL_FALLBACK_MS; }
}

let adpInt: any = null;
export function startAdaptiveTtlRefresh(): void { if (adpInt) return; void refAdpTtl(); adpInt = setInterval(refAdpTtl, PLAYER_L1_INFO_REFRESH_MS); }
export function stopAdaptiveTtlRefresh(): void { if (adpInt) { clearInterval(adpInt); adpInt = null; } }

function mapR<T>(row: CacheRow): any {
  const exp = Number(row.expires_at); const lm = row.last_modified === null ? null : Number(row.last_modified);
  const caRaw = row.cached_at; const ca = caRaw === null || caRaw === undefined ? null : Number(caRaw);
  let p: any = row.payload; if (typeof p === 'string') try { p = JSON.parse(p); } catch { return null; }
  const s = row.source as CacheSource | null;
  const vs = (s === 'hypixel' || s === 'community_verified' || s === 'community_unverified') ? s : null;
  return { value: p as T, expiresAt: exp, cachedAt: ca, etag: row.etag, lastModified: lm, source: vs };
}

async function getManyPFromDb(keys: string[], incExp: boolean): Promise<Map<string, any>> {
  await ensureInitialized(); const res = new Map<string, any>(); if (keys.length === 0) return res;
  try {
    const phs = keys.map((_, i) => pool.getPlaceholder(i + 1));
    const qRes = await pool.query<CacheRow & { cache_key: string }>(`SELECT payload, expires_at, cached_at, etag, last_modified, source, cache_key FROM player_stats_cache WHERE ${pool.getArrayInSql('cache_key', phs)}`, keys);
    markDbAccess();
    for (const row of qRes.rows) {
      const entry = mapR<MinimalPlayerStats>(row); if (!entry) { if (!incExp) void pool.query(`DELETE FROM player_stats_cache WHERE cache_key = ${pool.getPlaceholder(1)}`, [row.cache_key]); continue; }
      if (entry.expiresAt <= Date.now()) { if (!incExp) void pool.query(`DELETE FROM player_stats_cache WHERE cache_key = ${pool.getPlaceholder(1)}`, [row.cache_key]); if (incExp) res.set(row.cache_key, entry); continue; }
      res.set(row.cache_key, entry);
    }
  } catch (e) { console.error('[statsCache] batch read fail', e); }
  return res;
}

async function getPFromDb(key: string, incExp: boolean): Promise<any> {
  await ensureInitialized();
  try {
    const qRes = await pool.query<CacheRow>(`SELECT payload, expires_at, cached_at, etag, last_modified, source FROM player_stats_cache WHERE cache_key = ${pool.getPlaceholder(1)}`, [key]);
    markDbAccess(); const row = qRes.rows[0]; if (!row) return null;
    const entry = mapR<MinimalPlayerStats>(row); if (!entry) { if (!incExp) await pool.query(`DELETE FROM player_stats_cache WHERE cache_key = ${pool.getPlaceholder(1)}`, [key]); return null; }
    if (entry.expiresAt <= Date.now()) { if (!incExp) await pool.query(`DELETE FROM player_stats_cache WHERE cache_key = ${pool.getPlaceholder(1)}`, [key]); return incExp ? entry : null; }
    return entry;
  } catch (e) { console.error('[statsCache] read fail', e); return null; }
}

async function setPInDb(key: string, stats: MinimalPlayerStats, ttl: number, meta: CacheMetadata): Promise<void> {
  await ensureInitialized(); const ca = Date.now(); const exp = ca + ttl; const p = JSON.stringify(stats);
  try {
    const cols = ['cache_key', 'payload', 'expires_at', 'cached_at', 'etag', 'last_modified', 'source'];
    const ups = ['payload', 'expires_at', 'cached_at', 'etag', 'last_modified', 'source'];
    await pool.query(pool.getUpsertSql('player_stats_cache', cols, 'cache_key', ups), [key, p, exp, ca, meta.etag ?? null, meta.lastModified ?? null, meta.source ?? null]);
    markDbAccess();
  } catch (e) { console.error('[statsCache] write fail', e); }
}

async function getIMapFromDb(ign: string, incExp: boolean): Promise<any> {
  await ensureInitialized();
  try {
    const qRes = await pool.query<IgnRow>(`SELECT uuid, nicked, expires_at FROM ign_uuid_cache WHERE ign = ${pool.getPlaceholder(1)}`, [ign]);
    markDbAccess(); const row = qRes.rows[0]; if (!row) return null;
    const exp = Number(row.expires_at);
    if (exp <= Date.now()) { if (!incExp) await pool.query(`DELETE FROM ign_uuid_cache WHERE ign = ${pool.getPlaceholder(1)}`, [ign]); return incExp ? { uuid: row.uuid, nicked: !!row.nicked, expiresAt: exp } : null; }
    return { uuid: row.uuid, nicked: !!row.nicked, expiresAt: exp };
  } catch (e) { console.error('[statsCache] read ign fail', e); return null; }
}

async function setIMapInDb(ign: string, uuid: string | null, nicked: boolean, ttl: number): Promise<void> {
  await ensureInitialized(); const exp = Date.now() + ttl;
  try {
    const cols = ['ign', 'uuid', 'nicked', 'expires_at']; const ups = ['uuid', 'nicked', 'expires_at'];
    let sql = pool.getUpsertSql('ign_uuid_cache', cols, 'ign', ups);
    if (pool.type === DatabaseType.POSTGRESQL) sql = sql.replace('SET ', 'SET updated_at = NOW(), ');
    else sql = sql.replace('UPDATE SET ', 'UPDATE SET updated_at = SYSUTCDATETIME(), ');
    await pool.query(sql, [ign, uuid, nicked, exp]); markDbAccess();
  } catch (e) { console.error('[statsCache] write ign fail', e); }
}

async function getIMapFromRedis(ign: string, incExp: boolean): Promise<any> {
  const cli = getRedisClient(); if (!cli || cli.status !== 'ready') return null;
  try {
    const k = `cache:${buildIgnMappingKey(ign)}`; const d = await cli.get(k); if (!d) return null;
    let p: any; try { p = JSON.parse(d); } catch { await cli.del(k); return null; }
    if (p.expiresAt <= Date.now()) { await cli.del(k); return incExp ? p : null; }
    return p;
  } catch (e) { return null; }
}

async function setIMapInRedis(ign: string, map: any, ttl: number): Promise<void> {
  const cli = getRedisClient(); if (!cli || cli.status !== 'ready') return;
  try {
    const k = `cache:${buildIgnMappingKey(ign)}`; const d = JSON.stringify({ ...map, expiresAt: Date.now() + ttl });
    await cli.setex(k, Math.ceil(ttl / 1000), d);
  } catch (e) {}
}

export async function getPlayerStatsFromCache(key: string, incExp = false): Promise<any> {
  if (isRedisAvailable()) {
    try {
      const cli = getRedisClient(); if (cli && cli.status === 'ready') {
        const k = `cache:${key}`; const d = await cli.get(k);
        if (d) {
          let row: any; try { row = JSON.parse(d); } catch { await cli.del(k); }
          if (row) {
            const entry = mapR<MinimalPlayerStats>(row);
            if (entry && entry.expiresAt > Date.now()) { recordCacheHit(); recordCacheTierHit('l1'); recordCacheSourceHit('redis'); return entry; }
            await cli.del(k);
          }
        }
      }
    } catch (e) {}
  }
  if (!shouldReadFromDb()) return null;
  const l2 = await getPFromDb(key, incExp);
  if (l2) {
    recordCacheHit(); recordCacheTierHit('l2'); recordCacheSourceHit('sql');
    if (l2.expiresAt > Date.now()) void setPlayerStatsL1(key, l2.value, l2).catch(() => {});
    return l2;
  }
  return null;
}

export async function getPlayerStatsFromCacheWithSWR(key: string, uuid: string): Promise<any> {
  if (!SWR_ENABLED) return await getPlayerStatsFromCache(key, false);
  if (isRedisAvailable()) {
    try {
      const cli = getRedisClient(); if (cli && cli.status === 'ready') {
        const k = `cache:${key}`; const d = await cli.get(k);
        if (d) {
          let row: any; try { row = JSON.parse(d); } catch { await cli.del(k); }
          if (row) {
            const entry = mapR<MinimalPlayerStats>(row);
            if (entry) {
              const now = Date.now(); if (entry.expiresAt > now) { recordCacheHit(); recordCacheTierHit('l1'); recordCacheSourceHit('redis'); return { ...entry, isStale: false, staleAgeMs: 0 }; }
              if (now <= entry.expiresAt + SWR_STALE_TTL_MS) { recordCacheHit(); recordCacheTierHit('l1'); recordCacheSourceHit('redis'); triggerBGRefresh(key, uuid, entry); return { ...entry, isStale: true, staleAgeMs: now - (entry.cachedAt || (entry.expiresAt - getAdpTtl())) }; }
              await cli.del(k);
            }
          }
        }
      }
    } catch (e) {}
  }
  if (shouldReadFromDb()) {
    const l2 = await getPFromDb(key, true);
    if (l2) {
      const now = Date.now();
      if (l2.expiresAt > now) { recordCacheHit(); recordCacheTierHit('l2'); recordCacheSourceHit('sql'); void setPlayerStatsL1(key, l2.value, l2).catch(() => {}); return { ...l2, isStale: false, staleAgeMs: 0 }; }
      if (now <= l2.expiresAt + SWR_STALE_TTL_MS) { recordCacheHit(); recordCacheTierHit('l2'); recordCacheSourceHit('sql'); triggerBGRefresh(key, uuid, l2); return { ...l2, isStale: true, staleAgeMs: now - (l2.cachedAt || (l2.expiresAt - PLAYER_L2_TTL_MS)) }; }
      await pool.query(`DELETE FROM player_stats_cache WHERE cache_key = ${pool.getPlaceholder(1)}`, [key]); markDbAccess();
    }
  }
  return null;
}

function triggerBGRefresh(key: string, uuid: string, entry: CacheEntry<MinimalPlayerStats>): void {
  if (bgLocks.has(key)) return;
  const prom = (async () => {
    try {
      const res = await fetchHypixelPlayer(uuid, { etag: entry.etag ?? undefined, lastModified: entry.lastModified ?? undefined });
      if (res.notModified) { await setPlayerStatsL1(key, entry.value, entry); recordCacheRefresh('success'); return; }
      if (res.payload) { await setPlayerStatsBoth(key, extractMinimalStats(res.payload), { etag: res.etag ?? undefined, lastModified: res.lastModified ?? undefined, source: 'hypixel' }); recordCacheRefresh('success'); }
    } catch (e) { recordCacheRefresh('fail'); } finally { bgLocks.delete(key); }
  })();
  bgLocks.set(key, prom); void prom.catch(() => {});
}

export async function getManyPlayerStatsFromCacheWithSWR(ids: { key: string; uuid: string }[]): Promise<Map<string, any>> {
  const res = new Map<string, any>(); if (ids.length === 0) return res;
  if (!isRedisAvailable()) {
    if (shouldReadFromDb()) {
      const l2s = await getManyPFromDb(ids.map(i => i.key), true);
      for (const [k, e] of l2s) {
        const id = ids.find(i => i.key === k); if (!id) continue;
        const now = Date.now(); if (e.expiresAt > now) res.set(k, { ...e, isStale: false, staleAgeMs: 0 });
        else if (SWR_ENABLED && now <= e.expiresAt + SWR_STALE_TTL_MS) { triggerBGRefresh(k, id.uuid, e); res.set(k, { ...e, isStale: true, staleAgeMs: now - (e.cachedAt || (e.expiresAt - PLAYER_L2_TTL_MS)) }); }
      }
    }
    return res;
  }
  const cli = getRedisClient(); if (!cli || cli.status !== 'ready') return res;
  try {
    const vals = await cli.mget(...ids.map(i => `cache:${i.key}`));
    for (let i = 0; i < vals.length; i++) {
      if (!vals[i]) continue; let row: any; try { row = JSON.parse(vals[i]!); } catch { continue; }
      const entry = mapR<MinimalPlayerStats>(row); if (!entry) continue;
      const now = Date.now(); if (entry.expiresAt > now) { recordCacheHit(); recordCacheTierHit('l1'); recordCacheSourceHit('redis'); res.set(ids[i].key, { ...entry, isStale: false, staleAgeMs: 0 }); continue; }
      if (SWR_ENABLED && now <= entry.expiresAt + SWR_STALE_TTL_MS) { recordCacheHit(); recordCacheTierHit('l1'); recordCacheSourceHit('redis'); triggerBGRefresh(ids[i].key, ids[i].uuid, entry); res.set(ids[i].key, { ...entry, isStale: true, staleAgeMs: now - (entry.cachedAt || (entry.expiresAt - getAdpTtl())) }); }
    }
  } catch (e) {}
  const missing = ids.filter(i => !res.has(i.key));
  if (missing.length > 0 && shouldReadFromDb()) {
    const l2s = await getManyPFromDb(missing.map(m => m.key), true); const expK: string[] = [];
    for (const [k, e] of l2s) {
      const id = missing.find(m => m.key === k); if (!id) continue;
      const now = Date.now();
      if (e.expiresAt > now) { recordCacheHit(); recordCacheTierHit('l2'); recordCacheSourceHit('sql'); void setPlayerStatsL1(k, e.value, e).catch(() => {}); res.set(k, { ...e, isStale: false, staleAgeMs: 0 }); }
      else if (SWR_ENABLED && now <= e.expiresAt + SWR_STALE_TTL_MS) { recordCacheHit(); recordCacheTierHit('l2'); recordCacheSourceHit('sql'); triggerBGRefresh(k, id.uuid, e); res.set(k, { ...e, isStale: true, staleAgeMs: now - (e.cachedAt || (e.expiresAt - PLAYER_L2_TTL_MS)) }); }
      else expK.push(k);
    }
    if (expK.length > 0) {
      void (async () => { try {
        const phs = expK.map((_, i) => pool.getPlaceholder(i + 1));
        await pool.query(`DELETE FROM player_stats_cache WHERE ${pool.getArrayInSql('cache_key', phs)}`, expK);
      } catch (e) {} })();
    }
  }
  return res;
}

export async function setPlayerStatsL1(key: string, stats: MinimalPlayerStats, meta: CacheMetadata = {}): Promise<void> {
  const cli = getRedisClient(); if (!cli || cli.status !== 'ready') return;
  try {
    const ttl = getAdpTtl(); const ca = Date.now(); const exp = ca + ttl;
    const d = JSON.stringify({ payload: stats, expires_at: exp, cached_at: ca, etag: meta.etag ?? null, last_modified: meta.lastModified ?? null, source: meta.source ?? null });
    await cli.setex(`cache:${key}`, Math.ceil(ttl / 1000), d);
  } catch (e) {}
}

export async function setPlayerStatsBoth(key: string, stats: MinimalPlayerStats, meta: CacheMetadata = {}): Promise<void> {
  await Promise.all([ setPInDb(key, stats, PLAYER_L2_TTL_MS, meta), setPlayerStatsL1(key, stats, meta) ]);
}

export async function getIgnMapping(ign: string, incExp = false): Promise<any> {
  const l1 = await getIMapFromRedis(ign, incExp); if (l1) { recordCacheHit(); return l1; }
  if (!shouldReadFromDb()) return null;
  const l2 = await getIMapFromDb(ign, incExp);
  if (l2) { recordCacheHit(); if (l2.expiresAt > Date.now()) void setIMapInRedis(ign, l2, getAdpTtl()).catch(() => {}); return l2; }
  return null;
}

export async function setIgnMapping(ign: string, uuid: string | null, nicked: boolean): Promise<void> {
  const ttl = getAdpTtl();
  await Promise.all([ setIMapInRedis(ign, { uuid, nicked }, ttl), setIMapInDb(ign, uuid, nicked, IGN_L2_TTL_MS) ]);
}

export async function deletePlayerStatsEntries(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  if (isRedisAvailable()) {
    const cli = getRedisClient(); if (cli && cli.status === 'ready') try { await cli.del(...keys.map(k => `cache:${k}`)); } catch (e) {}
  }
  await ensureInitialized();
  try {
    const phs = keys.map((_, i) => pool.getPlaceholder(i + 1));
    const res = await pool.query(`DELETE FROM player_stats_cache WHERE ${pool.getArrayInSql('cache_key', phs)}`, keys);
    markDbAccess(); return res.rowCount;
  } catch (e) { return 0; }
}

export async function deleteIgnMappings(igns: string[]): Promise<number> {
  if (igns.length === 0) return 0;
  if (isRedisAvailable()) {
    const cli = getRedisClient(); if (cli && cli.status === 'ready') try { await cli.del(...igns.map(i => `cache:${buildIgnMappingKey(i)}`)); } catch (e) {}
  }
  await ensureInitialized();
  try {
    const phs = igns.map((_, i) => pool.getPlaceholder(i + 1));
    const res = await pool.query(`DELETE FROM ign_uuid_cache WHERE ${pool.getArrayInSql('ign', phs)}`, igns);
    markDbAccess(); return res.rowCount;
  } catch (e) { return 0; }
}

export async function clearAllPlayerStatsCaches(): Promise<number> {
  let del = 0;
  if (isRedisAvailable()) {
    const cli = getRedisClient(); if (cli && cli.status === 'ready') try {
      let curs = '0'; do {
        const [next, ks] = await cli.scan(curs, 'MATCH', 'cache:*', 'COUNT', 1000); curs = next;
        if (ks.length > 0) { await cli.del(...ks); del += ks.length; }
      } while (curs !== '0');
    } catch (e) {}
  }
  await ensureInitialized();
  try {
    const sRes = await pool.query('DELETE FROM player_stats_cache');
    const iRes = await pool.query('DELETE FROM ign_uuid_cache');
    markDbAccess(); return del + sRes.rowCount + iRes.rowCount;
  } catch (e) { return del; }
}

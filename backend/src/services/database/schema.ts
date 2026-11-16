/** One table: player stats rows keyed by `player:v2:<uuid>`. */
export interface PlayerStatsCacheTable {
  cache_key: string;
  payload: string; // JSON-serialised MinimalPlayerStats
  expires_at: number;
  cached_at: number | null;
  etag: string | null;
  last_modified: number | null;
  source: string | null;
}

/**
 * One row per player lookup. Pruned on the retention window.
 */
export interface LookupLogTable {
  id: string;
  looked_up_at: Date;
  identifier: string;
  username: string | null;
  stars: number | null;
  nicked: boolean;
  source: string;
  route: string;
  status: number;
  latency_ms: number;
}

export interface Database {
  player_stats_cache: PlayerStatsCacheTable;
  lookup_log: LookupLogTable;
}

/** One table: player stats rows keyed by `player:<uuid>`. */
export interface PlayerStatsCacheTable {
  cache_key: string;
  payload: string; // JSON-serialised MinimalPlayerStats
  expires_at: number;
  cached_at: number;
  etag: string | null;
  last_modified: number | null;
  source: string | null;
}

/**
 * One row per player the proxy has ever resolved. `lookups` and `cache_hits` are
 * running counters, so this table stays bounded by the player population instead of
 * growing with traffic.
 */
export interface TrackedPlayerTable {
  identifier: string;
  username: string | null;
  stars: number | null;
  nicked: boolean;
  lookups: number;
  cache_hits: number;
  last_source: string;
  last_status: number;
  last_latency_ms: number;
  first_seen_at: Date;
  last_looked_up_at: Date;
}

/** One row per player lookup. Pruned on the retention window. */
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
  tracked_players: TrackedPlayerTable;
  lookup_log: LookupLogTable;
}

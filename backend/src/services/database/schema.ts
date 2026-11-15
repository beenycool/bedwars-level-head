import { Generated } from 'kysely';

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

/** One row per HTTP lookup request, carrying its aggregate counts (a batch is one row). */
export interface LookupEventTable {
  id: Generated<string>;
  looked_up_at: Date;
  route: string;
  players: number;
  cache_hits: number;
  errors: number;
  latency_sum_ms: number;
  latency_max_ms: number;
}

export interface Database {
  player_stats_cache: PlayerStatsCacheTable;
  tracked_players: TrackedPlayerTable;
  lookup_events: LookupEventTable;
}

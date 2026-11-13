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

export interface Database {
  player_stats_cache: PlayerStatsCacheTable;
}

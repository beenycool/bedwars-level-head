export interface PlayerStatsCacheTable {
  cache_key: string;
  payload: string;
  expires_at: number;
  cached_at: number | null;
  etag: string | null;
  last_modified: number | null;
  source: string | null;
}

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

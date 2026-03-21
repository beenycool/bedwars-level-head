import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

export interface PlayerStatsCacheTable {
  cache_key: string;
  payload: string; // JSON string
  expires_at: number;
  cached_at: number;
  etag: string | null;
  last_modified: number | null;
  source: string | null;
}

export interface IgnUuidCacheTable {
  ign: string;
  uuid: string | null;
  nicked: boolean; // Managed by db driver mapping
  expires_at: number;
}

export interface PlayerQueryHistoryTable {
  id: Generated<number>; // BIGSERIAL / IDENTITY
  identifier: string;
  normalized_identifier: string;
  lookup_type: string;
  resolved_uuid: string | null;
  resolved_username: string | null;
  stars: number | null;
  nicked: boolean;
  cache_source: string;
  cache_hit: boolean;
  revalidated: boolean;
  install_id: string | null;
  response_status: number;
  latency_ms: number | null;
  requested_at: ColumnType<Date, Date | string | undefined, never>; // Default NOW()
}

export interface RateLimitsTable {
  key: string;
  count: number;
  window_start: number;
}

export interface ResourceMetricsTable {
  id: Generated<number>;
  bucket_start: Date;
  avg_rss_mb: number;
  max_rss_mb: number;
  min_rss_mb: number;
  p95_rss_mb: number;
  p99_rss_mb: number;
  avg_heap_mb: number;
  max_heap_mb: number;
  min_heap_mb: number;
  p95_heap_mb: number;
  p99_heap_mb: number;
  avg_cpu_percent: number;
  max_cpu_percent: number;
  min_cpu_percent: number;
  p95_cpu_percent: number;
  p99_cpu_percent: number;
  sample_count: number;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface HypixelApiCallsTable {
  id: Generated<number>;
  called_at: number;
  uuid: string;
}

export interface SystemKvTable {
  key: string;
  value: string;
}

export interface Database {
  player_stats_cache: PlayerStatsCacheTable;
  ign_uuid_cache: IgnUuidCacheTable;
  player_query_history: PlayerQueryHistoryTable;
  rate_limits: RateLimitsTable;
  resource_metrics: ResourceMetricsTable;
  hypixel_api_calls: HypixelApiCallsTable;
  system_kv: SystemKvTable;
}

export type PlayerStatsCache = Selectable<PlayerStatsCacheTable>;
export type NewPlayerStatsCache = Insertable<PlayerStatsCacheTable>;
export type PlayerStatsCacheUpdate = Updateable<PlayerStatsCacheTable>;

export type IgnUuidCache = Selectable<IgnUuidCacheTable>;
export type NewIgnUuidCache = Insertable<IgnUuidCacheTable>;
export type IgnUuidCacheUpdate = Updateable<IgnUuidCacheTable>;

export type PlayerQueryHistory = Selectable<PlayerQueryHistoryTable>;
export type NewPlayerQueryHistory = Insertable<PlayerQueryHistoryTable>;
export type PlayerQueryHistoryUpdate = Updateable<PlayerQueryHistoryTable>;

export type RateLimits = Selectable<RateLimitsTable>;
export type NewRateLimits = Insertable<RateLimitsTable>;
export type RateLimitsUpdate = Updateable<RateLimitsTable>;

export type ResourceMetrics = Selectable<ResourceMetricsTable>;
export type NewResourceMetrics = Insertable<ResourceMetricsTable>;
export type ResourceMetricsUpdate = Updateable<ResourceMetricsTable>;

export type HypixelApiCalls = Selectable<HypixelApiCallsTable>;
export type NewHypixelApiCalls = Insertable<HypixelApiCallsTable>;
export type HypixelApiCallsUpdate = Updateable<HypixelApiCallsTable>;

export type SystemKv = Selectable<SystemKvTable>;
export type NewSystemKv = Insertable<SystemKvTable>;
export type SystemKvUpdate = Updateable<SystemKvTable>;

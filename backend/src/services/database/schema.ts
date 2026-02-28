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
  nicked: boolean; // boolean in PG, BIT (0/1) in MSSQL - Kysely handles boolean mapping usually
  expires_at: number;
  // updated_at is handled by the database schema (default/on update), but we might want to interact with it
  // In the current schema, updated_at is not explicitly defined in the create table statements seen,
  // but let's include it if needed or remove if not present in actual DB schema
  // Based on statsCache.ts, it uses NOW() or SYSUTCDATETIME() in SQL queries.
  // We'll omit it from the interface if we don't select/insert it directly, or treat as optional.
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

export interface Database {
  player_stats_cache: PlayerStatsCacheTable;
  ign_uuid_cache: IgnUuidCacheTable;
  player_query_history: PlayerQueryHistoryTable;
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

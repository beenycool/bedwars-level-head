import { sql } from 'kysely';
import { db } from './database/db';
import { ensureInitialized, isDatabaseReady } from './cache';
import { LOOKUP_EVENT_RETENTION_DAYS, LOOKUP_TRACKING_ENABLED } from '../config';
import { bedwarsStars } from '../util/bedwarsStars';
import { logger } from '../util/logger';

/** Where the lookup came from; kept coarse so the site can break traffic down. */
export type LookupRoute = 'public' | 'legacy' | 'batch';

/** Everything one resolved player contributes to the tracking tables. */
export interface LookupObservation {
  identifier: string;
  username: string | null;
  bedwarsExperience: number | null;
  nicked: boolean;
  source: 'cache' | 'network';
  status: number;
  latencyMs: number;
}

export interface LookupSummary {
  players: number;
  cacheHits: number;
  errors: number;
  latencySumMs: number;
  latencyMaxMs: number;
}

export interface TrackedPlayerUpsert {
  identifier: string;
  username: string | null;
  stars: number | null;
  nicked: boolean;
  cacheHit: boolean;
  lastSource: string;
  lastStatus: number;
  latencyMs: number;
}

/** Pure: aggregate one request's observations into the `lookup_events` row. */
export function summarizeObservations(observations: LookupObservation[]): LookupSummary {
  let cacheHits = 0;
  let errors = 0;
  let latencySumMs = 0;
  let latencyMaxMs = 0;

  for (const observation of observations) {
    if (observation.source === 'cache') {
      cacheHits += 1;
    }
    if (Math.floor(observation.status / 100) >= 4) {
      errors += 1;
    }
    const latency = Number.isFinite(observation.latencyMs) ? Math.max(0, Math.round(observation.latencyMs)) : 0;
    latencySumMs += latency;
    latencyMaxMs = Math.max(latencyMaxMs, latency);
  }

  return { players: observations.length, cacheHits, errors, latencySumMs, latencyMaxMs };
}

/**
 * Pure: one upsert row per identifier. Duplicates (possible if a caller hands us the
 * same UUID twice) collapse to the last observation, because PostgreSQL rejects an
 * `ON CONFLICT` statement that touches the same row twice.
 *
 * Failed lookups are deliberately skipped: `lookup_events` still counts them, but
 * writing a player row for every 404 would let a UUID scanner grow the table without
 * bound. A row therefore only exists for a player the proxy has actually resolved.
 */
export function buildTrackedPlayerRows(observations: LookupObservation[]): TrackedPlayerUpsert[] {
  const byIdentifier = new Map<string, TrackedPlayerUpsert>();

  for (const observation of observations) {
    if (Math.floor(observation.status / 100) >= 4) {
      continue;
    }

    byIdentifier.set(observation.identifier, {
      identifier: observation.identifier,
      username: observation.username,
      stars: observation.nicked ? null : bedwarsStars(observation.bedwarsExperience),
      nicked: observation.nicked,
      cacheHit: observation.source === 'cache',
      lastSource: observation.source,
      lastStatus: observation.status,
      latencyMs: Math.max(0, Math.round(observation.latencyMs)),
    });
  }

  return [...byIdentifier.values()];
}

/**
 * Fire-and-forget recorder. Tracking must never slow down or fail a lookup, so the
 * write is detached and every failure is downgraded to a warning.
 */
export function recordLookups(observations: LookupObservation[], route: LookupRoute): void {
  if (!LOOKUP_TRACKING_ENABLED || observations.length === 0) {
    return;
  }
  void persistLookups(observations, route).catch((error) => {
    logger.warn({ err: error }, '[tracking] failed to record lookups');
  });
}

async function persistLookups(observations: LookupObservation[], route: LookupRoute): Promise<void> {
  await ensureInitialized();
  if (!isDatabaseReady()) {
    return;
  }

  const lookedUpAt = new Date();
  const rows = buildTrackedPlayerRows(observations);
  const summary = summarizeObservations(observations);

  // A request made entirely of failed lookups has no player rows to upsert, and an
  // empty `VALUES` list is invalid SQL. The event row still has to be written so the
  // error counters move.
  if (rows.length > 0) {
    await buildTrackedPlayersUpsert(rows, lookedUpAt).execute(db);
  }

  await db
    .insertInto('lookup_events')
    .values({
      looked_up_at: lookedUpAt,
      route,
      players: summary.players,
      cache_hits: summary.cacheHits,
      errors: summary.errors,
      latency_sum_ms: summary.latencySumMs,
      latency_max_ms: summary.latencyMaxMs,
    })
    .execute();
}

/**
 * Multi-row upsert written as SQL: `excluded` is the only way to express "increment
 * the existing counter" without a read-modify-write race. Exported so the SQL can be
 * compiled in tests without a live database.
 */
export function buildTrackedPlayersUpsert(rows: TrackedPlayerUpsert[], lookedUpAt: Date) {
  const values = rows.map(
    (row) => sql`(
      ${row.identifier}, ${row.username}, ${row.stars}, ${row.nicked},
      ${row.cacheHit ? 1 : 0}, ${row.lastSource}, ${row.lastStatus}, ${row.latencyMs}, ${lookedUpAt}
    )`,
  );

  return sql`
    INSERT INTO tracked_players (
      identifier, username, stars, nicked, cache_hits,
      last_source, last_status, last_latency_ms, last_looked_up_at
    )
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT (identifier) DO UPDATE SET
      lookups = tracked_players.lookups + 1,
      cache_hits = tracked_players.cache_hits + CASE WHEN excluded.last_source = 'cache' THEN 1 ELSE 0 END,
      username = COALESCE(excluded.username, tracked_players.username),
      stars = COALESCE(excluded.stars, tracked_players.stars),
      nicked = excluded.nicked,
      last_source = excluded.last_source,
      last_status = excluded.last_status,
      last_latency_ms = excluded.last_latency_ms,
      last_looked_up_at = excluded.last_looked_up_at
  `;
}

/** Deletes request rows past the retention window. Called hourly by the scheduler. */
export async function pruneLookupEvents(now: number = Date.now()): Promise<number> {
  await ensureInitialized();
  if (!isDatabaseReady()) {
    return 0;
  }

  const cutoff = new Date(now - LOOKUP_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await sql`DELETE FROM lookup_events WHERE looked_up_at < ${cutoff}`.execute(db);
  const deleted = Number(result.numAffectedRows ?? 0);
  if (deleted > 0) {
    logger.info(`[tracking] pruned ${deleted} lookup_events rows older than ${LOOKUP_EVENT_RETENTION_DAYS} days`);
  }
  return deleted;
}

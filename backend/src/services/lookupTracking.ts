import { sql } from 'kysely';
import { db } from './database/db';
import { ensureInitialized, isDatabaseReady } from './cache';
import { LOOKUP_LOG_RETENTION_DAYS, LOOKUP_TRACKING_ENABLED } from '../config';
import { bedwarsStars } from '../util/bedwarsStars';
import { logger } from '../util/logger';
import { recordLookupSignals } from './rateLimitSignals';

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

/** One row in `lookup_log`, preserving every observation for the analytics page. */
export interface LookupLogRow {
  lookedUpAt: Date;
  identifier: string;
  username: string | null;
  stars: number | null;
  nicked: boolean;
  source: string;
  route: LookupRoute;
  status: number;
  latencyMs: number;
}

/**
 * Pure: one log row per observation, including failures. The log is append-only
 * and pruned, so failures are cheap to keep.
 */
export function buildLookupLogRows(
  observations: LookupObservation[],
  route: LookupRoute,
  lookedUpAt: Date,
): LookupLogRow[] {
  return observations.map((observation) => ({
    lookedUpAt,
    identifier: observation.identifier,
    username: observation.username,
    stars: observation.nicked ? null : bedwarsStars(observation.bedwarsExperience),
    nicked: observation.nicked,
    source: observation.source,
    route,
    status: observation.status,
    latencyMs: Math.max(0, Math.round(observation.latencyMs)),
  }));
}

/**
 * Fire-and-forget recorder. Tracking must never slow down or fail a lookup, so the
 * write is detached and every failure is downgraded to a warning.
 */
export function recordLookups(observations: LookupObservation[], route: LookupRoute): void {
  recordLookupSignals(observations);
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

  await buildLookupLogInsert(buildLookupLogRows(observations, route, lookedUpAt)).execute(db);
}

/** Multi-row insert for the append-only log. Exported so it can be compiled in tests. */
export function buildLookupLogInsert(rows: LookupLogRow[]) {
  const values = rows.map(
    (row) => sql`(
      ${row.lookedUpAt}, ${row.identifier}, ${row.username}, ${row.stars}, ${row.nicked},
      ${row.source}, ${row.route}, ${row.status}, ${row.latencyMs}
    )`,
  );

  return sql`
    INSERT INTO lookup_log (
      looked_up_at, identifier, username, stars, nicked,
      source, route, status, latency_ms
    )
    VALUES ${sql.join(values, sql`, `)}
  `;
}

/** Deletes log rows past the retention window. Called hourly by the scheduler. */
export async function pruneLookupLogs(now: number = Date.now()): Promise<number> {
  await ensureInitialized();
  if (!isDatabaseReady()) {
    return 0;
  }

  const cutoff = new Date(now - LOOKUP_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await sql`DELETE FROM lookup_log WHERE looked_up_at < ${cutoff}`.execute(db);
  const deleted = Number(result.numAffectedRows ?? 0);
  if (deleted > 0) {
    logger.info(`[tracking] pruned ${deleted} lookup_log rows older than ${LOOKUP_LOG_RETENTION_DAYS} days`);
  }
  return deleted;
}

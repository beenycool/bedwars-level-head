import { sql } from 'kysely';
import { db, isCockroachDb } from './db';
import { logger } from '../../util/logger';

interface CockroachTtlOptions {
  tableName: string;
  expirationExpression: string;
  jobCron?: string;
}

const ttlSetupPromises = new Map<string, Promise<boolean>>();
const ttlManagedTables = new Set<string>();
/** Tables where TTL ALTER failed this process; avoid repeating failing statements until restart. */
const ttlSkippedTables = new Set<string>();

function databaseErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return code === undefined || code === null ? undefined : String(code);
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function quoteSqlIdentifier(identifier: string): string {
  return identifier
    .split('.')
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join('.');
}

export function isCockroachTtlManaged(tableName: string): boolean {
  return ttlManagedTables.has(tableName);
}

export async function ensureCockroachRowLevelTtl({
  tableName,
  expirationExpression,
  jobCron = '@daily',
}: CockroachTtlOptions): Promise<boolean> {
  if (ttlManagedTables.has(tableName)) {
    return true;
  }
  if (ttlSkippedTables.has(tableName)) {
    return false;
  }

  const existingPromise = ttlSetupPromises.get(tableName);
  if (existingPromise) {
    return await existingPromise;
  }

  const setupPromise = (async () => {
    if (!(await isCockroachDb())) {
      return false;
    }

    try {
      await sql`ALTER TABLE ${sql.raw(quoteSqlIdentifier(tableName))} SET (ttl_expiration_expression = ${sql.raw(expirationExpression)}, ttl_job_cron = ${jobCron})`.execute(db);

      ttlManagedTables.add(tableName);
      logger.info(`[db] enabled Cockroach row-level TTL for ${tableName}`);
      return true;
    } catch (error) {
      ttlSkippedTables.add(tableName);
      const code = databaseErrorCode(error);
      logger.debug(
        { err: error, tableName, ...(code !== undefined ? { code } : {}) },
        '[db] Cockroach row-level TTL is optional; skipped after setup failed (table will work without TTL)',
      );
      return false;
    } finally {
      if (!ttlManagedTables.has(tableName)) {
        ttlSetupPromises.delete(tableName);
      }
    }
  })();

  ttlSetupPromises.set(tableName, setupPromise);
  return await setupPromise;
}

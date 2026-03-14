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

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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

  const existingPromise = ttlSetupPromises.get(tableName);
  if (existingPromise) {
    return await existingPromise;
  }

  const setupPromise = (async () => {
    if (!(await isCockroachDb())) {
      return false;
    }

    try {
      await sql.raw(
        `ALTER TABLE ${tableName} SET (` +
          `ttl_expiration_expression = ${quoteSqlLiteral(expirationExpression)}, ` +
          `ttl_job_cron = ${quoteSqlLiteral(jobCron)}` +
        `)`
      ).execute(db);

      ttlManagedTables.add(tableName);
      logger.info(`[db] enabled Cockroach row-level TTL for ${tableName}`);
      return true;
    } catch (error) {
      logger.warn({ error, tableName }, '[db] failed to enable Cockroach row-level TTL');
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

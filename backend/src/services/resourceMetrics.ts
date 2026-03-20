import { pool } from './cache';
import { sql } from 'kysely';
import { DatabaseType, dbType } from './database/db';
import os from 'os';
import { logger } from '../util/logger';

interface MemorySample {
  timestamp: number;
  rssMB: number;
  heapMB: number;
  heapTotalMB: number;
  externalMB: number;
  cpuPercent: number;
}

interface BucketAggregate {
  bucketStart: Date;
  avgRssMB: number;
  maxRssMB: number;
  minRssMB: number;
  p95RssMB: number;
  p99RssMB: number;
  avgHeapMB: number;
  maxHeapMB: number;
  minHeapMB: number;
  p95HeapMB: number;
  p99HeapMB: number;
  avgCpuPercent: number;
  maxCpuPercent: number;
  minCpuPercent: number;
  p95CpuPercent: number;
  p99CpuPercent: number;
  sampleCount: number;
}

const SAMPLE_INTERVAL_MS = 30_000;
const FLUSH_INTERVAL_MS = 60 * 1000; // Flush every minute
const BUCKET_INTERVAL_MS = 60 * 1000; // 1-minute buckets
// Default 300 samples (2.5 hours) prevents memory bloat during DB outages.
// Can be tuned via RESOURCE_METRICS_BUFFER_SIZE env var.
const MAX_BUFFER_SIZE = parseInt(process.env.RESOURCE_METRICS_BUFFER_SIZE || '300', 10);
const RETENTION_DAYS = 30;

let memoryBuffer: MemorySample[] = [];
let isFlushing = false;

let lastCpuUsage: NodeJS.CpuUsage | null = null;
let lastCpuCheckTime = 0;
let sampleInterval: NodeJS.Timeout | null = null;
let flushInterval: NodeJS.Timeout | null = null;
let alignmentTimeout: NodeJS.Timeout | null = null;

const weightedAvg = (v1: number, c1: number, v2: number, c2: number) => (v1 * c1 + v2 * c2) / (c1 + c2);

function getCpuPercent(): number {
  const now = Date.now();
  const currentUsage = process.cpuUsage();

  if (!lastCpuUsage || lastCpuCheckTime === 0) {
    lastCpuUsage = currentUsage;
    lastCpuCheckTime = now;
    return 0;
  }

  const userDiff = currentUsage.user - lastCpuUsage.user;
  const systemDiff = currentUsage.system - lastCpuUsage.system;
  const elapsedMs = now - lastCpuCheckTime;

  lastCpuUsage = currentUsage;
  lastCpuCheckTime = now;

  if (elapsedMs <= 0) return 0;

  const totalMicroseconds = userDiff + systemDiff;
  const elapsedMicroseconds = elapsedMs * 1000;
  const numCpus = Math.max(1, os.cpus().length);

  return Math.min(100, (totalMicroseconds / elapsedMicroseconds) * 100 / numCpus);
}

function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

const arrayMax = (arr: number[]) => arr.reduce((a, b) => Math.max(a, b), -Infinity);
const arrayMin = (arr: number[]) => arr.reduce((a, b) => Math.min(a, b), Infinity);
const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
const avg = (arr: number[]) => arr.length > 0 ? sum(arr) / arr.length : 0;

function getBucketStart(timestamp: number): Date {
  const roundedMs = Math.floor(timestamp / BUCKET_INTERVAL_MS) * BUCKET_INTERVAL_MS;
  return new Date(roundedMs);
}

function aggregateToBuckets(samples: MemorySample[]): BucketAggregate[] {
  const buckets = new Map<string, MemorySample[]>();

  for (const sample of samples) {
    const bucketKey = getBucketStart(sample.timestamp).toISOString();
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey)!.push(sample);
  }

  const aggregates: BucketAggregate[] = [];
  for (const bucketSamples of buckets.values()) {
    const rssValues = bucketSamples.map(s => s.rssMB).sort((a, b) => a - b);
    const heapValues = bucketSamples.map(s => s.heapMB).sort((a, b) => a - b);
    const cpuValues = bucketSamples.map(s => s.cpuPercent).sort((a, b) => a - b);

    aggregates.push({
      bucketStart: getBucketStart(bucketSamples[0].timestamp),
      avgRssMB: avg(rssValues),
      maxRssMB: rssValues.length > 0 ? arrayMax(rssValues) : 0,
      minRssMB: rssValues.length > 0 ? arrayMin(rssValues) : 0,
      p95RssMB: calculatePercentile(rssValues, 95),
      p99RssMB: calculatePercentile(rssValues, 99),
      avgHeapMB: avg(heapValues),
      maxHeapMB: heapValues.length > 0 ? arrayMax(heapValues) : 0,
      minHeapMB: heapValues.length > 0 ? arrayMin(heapValues) : 0,
      p95HeapMB: calculatePercentile(heapValues, 95),
      p99HeapMB: calculatePercentile(heapValues, 99),
      avgCpuPercent: avg(cpuValues),
      maxCpuPercent: cpuValues.length > 0 ? arrayMax(cpuValues) : 0,
      minCpuPercent: cpuValues.length > 0 ? arrayMin(cpuValues) : 0,
      p95CpuPercent: calculatePercentile(cpuValues, 95),
      p99CpuPercent: calculatePercentile(cpuValues, 99),
      sampleCount: bucketSamples.length,
    });
  }

  return aggregates.sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());
}

async function persistAggregate(aggregates: BucketAggregate[]): Promise<void> {
  try {
    for (const aggregate of aggregates) {
      let existing;
      existing = await pool.selectFrom('resource_metrics')
        .selectAll()
        .where('bucket_start', '=', aggregate.bucketStart)
        .executeTakeFirst();

      if (!existing) {
        await pool.insertInto('resource_metrics').values({
          bucket_start: aggregate.bucketStart,
          avg_rss_mb: aggregate.avgRssMB,
          max_rss_mb: aggregate.maxRssMB,
          min_rss_mb: aggregate.minRssMB,
          p95_rss_mb: aggregate.p95RssMB,
          p99_rss_mb: aggregate.p99RssMB,
          avg_heap_mb: aggregate.avgHeapMB,
          max_heap_mb: aggregate.maxHeapMB,
          min_heap_mb: aggregate.minHeapMB,
          p95_heap_mb: aggregate.p95HeapMB,
          p99_heap_mb: aggregate.p99HeapMB,
          avg_cpu_percent: aggregate.avgCpuPercent,
          max_cpu_percent: aggregate.maxCpuPercent,
          min_cpu_percent: aggregate.minCpuPercent,
          p95_cpu_percent: aggregate.p95CpuPercent,
          p99_cpu_percent: aggregate.p99CpuPercent,
          sample_count: aggregate.sampleCount
        }).execute();
      } else {
        const existingSampleCount = existing.sample_count;
        const newTotalCount = existingSampleCount + aggregate.sampleCount;

        const mergedAvgRssMB = weightedAvg(existing.avg_rss_mb, existingSampleCount, aggregate.avgRssMB, aggregate.sampleCount);
        const mergedMaxRssMB = Math.max(existing.max_rss_mb, aggregate.maxRssMB);
        const mergedMinRssMB = Math.min(existing.min_rss_mb, aggregate.minRssMB);

        // Percentiles cannot be accurately averaged.
        // We prefer the latest aggregate's percentile as a deterministic fallback for merged buckets.
        const mergedP95RssMB = aggregate.p95RssMB;
        const mergedP99RssMB = aggregate.p99RssMB;

        const mergedAvgHeapMB = weightedAvg(existing.avg_heap_mb, existingSampleCount, aggregate.avgHeapMB, aggregate.sampleCount);
        const mergedMaxHeapMB = Math.max(existing.max_heap_mb, aggregate.maxHeapMB);
        const mergedMinHeapMB = Math.min(existing.min_heap_mb, aggregate.minHeapMB);
        const mergedP95HeapMB = aggregate.p95HeapMB;
        const mergedP99HeapMB = aggregate.p99HeapMB;

        const mergedAvgCpuPercent = weightedAvg(existing.avg_cpu_percent, existingSampleCount, aggregate.avgCpuPercent, aggregate.sampleCount);
        const mergedMaxCpuPercent = Math.max(existing.max_cpu_percent, aggregate.maxCpuPercent);
        const mergedMinCpuPercent = Math.min(existing.min_cpu_percent, aggregate.minCpuPercent);
        const mergedP95CpuPercent = aggregate.p95CpuPercent;
        const mergedP99CpuPercent = aggregate.p99CpuPercent;

        await pool.updateTable('resource_metrics').set({
          avg_rss_mb: mergedAvgRssMB,
          max_rss_mb: mergedMaxRssMB,
          min_rss_mb: mergedMinRssMB,
          p95_rss_mb: mergedP95RssMB,
          p99_rss_mb: mergedP99RssMB,
          avg_heap_mb: mergedAvgHeapMB,
          max_heap_mb: mergedMaxHeapMB,
          min_heap_mb: mergedMinHeapMB,
          p95_heap_mb: mergedP95HeapMB,
          p99_heap_mb: mergedP99HeapMB,
          avg_cpu_percent: mergedAvgCpuPercent,
          max_cpu_percent: mergedMaxCpuPercent,
          min_cpu_percent: mergedMinCpuPercent,
          p95_cpu_percent: mergedP95CpuPercent,
          p99_cpu_percent: mergedP99CpuPercent,
          sample_count: newTotalCount
        }).where('bucket_start', '=', aggregate.bucketStart).execute();
      }
    }
  } catch (err) {
    logger.error({ err }, '[resourceMetrics] failed to persist aggregate');
    throw err;
  }
}

async function flushBuffer(): Promise<void> {
  if (isFlushing) {
    return;
  }
  isFlushing = true;

  try {
    if (memoryBuffer.length === 0) return;

    // Snapshot and clear buffer immediately
    const samples = memoryBuffer;
    memoryBuffer = [];

    const aggregates = aggregateToBuckets(samples);
    if (aggregates.length === 0) {
      return;
    }

    try {
      await persistAggregate(aggregates);
      const uniqueBuckets = aggregates.length;
      logger.info(`[resourceMetrics] flushed ${samples.length} samples across ${uniqueBuckets} bucket${uniqueBuckets > 1 ? 's' : ''}`);
    } catch (error) {
      logger.warn({ err: error }, 'Failed to flush resource metrics buffer, retaining for retry:');
      // Prepend failed samples back to buffer
      memoryBuffer = samples.concat(memoryBuffer);
    }
  } finally {
    isFlushing = false;
  }
}

async function pruneOldData(): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);

    if (dbType === DatabaseType.POSTGRESQL) {
      const result = await sql`DELETE FROM resource_metrics WHERE bucket_start < ${cutoff}`.execute(pool);
      if (Number(result.numUpdatedOrDeletedRows) > 0) {
        logger.info(`[resourceMetrics] pruned ${Number(result.numUpdatedOrDeletedRows)} old records`);
      }
    } else {
      const result = await sql`DELETE FROM resource_metrics WHERE bucket_start < ${cutoff}`.execute(pool);
      if (Number(result.numUpdatedOrDeletedRows) > 0) {
        logger.info(`[resourceMetrics] pruned ${Number(result.numUpdatedOrDeletedRows)} old records`);
      }
    }
  } catch (err) {
    logger.error({ err }, '[resourceMetrics] failed to prune old data');
  }
}

function takeSample(): void {
  const memUsage = process.memoryUsage();
  const cpuPercent = getCpuPercent();

  const sample: MemorySample = {
    timestamp: Date.now(),
    rssMB: memUsage.rss / 1024 / 1024,
    heapMB: memUsage.heapUsed / 1024 / 1024,
    heapTotalMB: memUsage.heapTotal / 1024 / 1024,
    externalMB: memUsage.external / 1024 / 1024,
    cpuPercent,
  };

  memoryBuffer.push(sample);

  if (memoryBuffer.length > MAX_BUFFER_SIZE) {
    memoryBuffer.splice(0, memoryBuffer.length - MAX_BUFFER_SIZE);
  }
}

export async function initializeResourceMetrics(): Promise<void> {
  try {
    if (dbType === DatabaseType.POSTGRESQL) {
      // Backward compatibility: rename hour_start to bucket_start if it exists
      try {
        await sql`SELECT 1 FROM information_schema.columns WHERE table_name='resource_metrics' AND column_name='hour_start'`.execute(pool).then(async (res: any) => {
          if (res.rows && res.rows.length > 0) {
            try {
              await sql`ALTER TABLE resource_metrics RENAME COLUMN hour_start TO bucket_start`.execute(pool);
            } catch (err: any) {
              if (err.code !== '42703') throw err;
            }
          }
        });
      } catch (err) {
        logger.error({ err }, '[resourceMetrics] checkColumnResult failed');
      }

      await sql`CREATE TABLE IF NOT EXISTS resource_metrics (
          id BIGSERIAL PRIMARY KEY,
          bucket_start TIMESTAMPTZ NOT NULL UNIQUE,
          avg_rss_mb FLOAT NOT NULL,
          max_rss_mb FLOAT NOT NULL,
          min_rss_mb FLOAT NOT NULL,
          p95_rss_mb FLOAT NOT NULL,
          p99_rss_mb FLOAT NOT NULL,
          avg_heap_mb FLOAT NOT NULL,
          max_heap_mb FLOAT NOT NULL,
          min_heap_mb FLOAT NOT NULL,
          p95_heap_mb FLOAT NOT NULL,
          p99_heap_mb FLOAT NOT NULL,
          avg_cpu_percent FLOAT NOT NULL,
          max_cpu_percent FLOAT NOT NULL,
          min_cpu_percent FLOAT NOT NULL,
          p95_cpu_percent FLOAT NOT NULL,
          p99_cpu_percent FLOAT NOT NULL,
          sample_count INTEGER NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`.execute(pool);
    } else {
      // For Azure SQL
      await sql`IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[resource_metrics]') AND name = 'hour_start')
        EXEC sp_rename 'resource_metrics.hour_start', 'bucket_start', 'COLUMN';`.execute(pool);

      await sql`IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[resource_metrics]') AND type in (N'U'))
        CREATE TABLE resource_metrics (
          id BIGINT IDENTITY(1,1) PRIMARY KEY,
          bucket_start DATETIME2 NOT NULL,
          avg_rss_mb FLOAT NOT NULL,
          max_rss_mb FLOAT NOT NULL,
          min_rss_mb FLOAT NOT NULL,
          p95_rss_mb FLOAT NOT NULL,
          p99_rss_mb FLOAT NOT NULL,
          avg_heap_mb FLOAT NOT NULL,
          max_heap_mb FLOAT NOT NULL,
          min_heap_mb FLOAT NOT NULL,
          p95_heap_mb FLOAT NOT NULL,
          p99_heap_mb FLOAT NOT NULL,
          avg_cpu_percent FLOAT NOT NULL,
          max_cpu_percent FLOAT NOT NULL,
          min_cpu_percent FLOAT NOT NULL,
          p95_cpu_percent FLOAT NOT NULL,
          p99_cpu_percent FLOAT NOT NULL,
          sample_count INTEGER NOT NULL,
          created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        )`.execute(pool);
      await sql`IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_resource_metrics_bucket')
        CREATE UNIQUE INDEX idx_resource_metrics_bucket ON resource_metrics (bucket_start)`.execute(pool);
    }
    logger.info('[resourceMetrics] table is ready');
  } catch (err) {
    logger.error({ err }, '[resourceMetrics] failed to initialize table');
    throw err;
  }

  getCpuPercent();

  sampleInterval = setInterval(() => {
    try {
      takeSample();
    } catch (err) {
      logger.error({ err }, '[resourceMetrics] sample error');
    }
  }, SAMPLE_INTERVAL_MS);

  const now = new Date();
  const nextBucket = new Date(Math.ceil(now.getTime() / FLUSH_INTERVAL_MS) * FLUSH_INTERVAL_MS);
  const msUntilNextBucket = nextBucket.getTime() - now.getTime();

  alignmentTimeout = setTimeout(() => {
    void flushBuffer().catch(err => logger.error({ err }, '[resourceMetrics] flush error'));
    void pruneOldData().catch(err => logger.error({ err }, '[resourceMetrics] prune error'));
    flushInterval = setInterval(() => {
      void flushBuffer().catch(err => logger.error({ err }, '[resourceMetrics] flush error'));
      void pruneOldData().catch(err => logger.error({ err }, '[resourceMetrics] prune error'));
    }, FLUSH_INTERVAL_MS);
  }, msUntilNextBucket);

  logger.info('[resourceMetrics] initialized');
}

export function stopResourceMetrics(): void {
  if (sampleInterval) {
    clearInterval(sampleInterval);
    sampleInterval = null;
  }
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  if (alignmentTimeout) {
    clearTimeout(alignmentTimeout);
    alignmentTimeout = null;
  }
}

export async function flushResourceMetricsOnShutdown(): Promise<void> {
  await flushBuffer();
}

export interface CurrentResourceMetrics {
  rssMB: number;
  heapMB: number;
  heapTotalMB: number;
  externalMB: number;
  cpuPercent: number;
  bufferSize: number;
}

export async function getCurrentResourceMetrics(): Promise<CurrentResourceMetrics> {
  const memUsage = process.memoryUsage();
  const cpuPercent = getCpuPercent();
  const bufferSize = memoryBuffer.length;

  return {
    rssMB: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100,
    heapMB: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100,
    heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
    externalMB: Math.round(memUsage.external / 1024 / 1024 * 100) / 100,
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    bufferSize,
  };
}

export interface ResourceMetricsHistoryRow {
  bucketStart: Date;
  avgRssMB: number;
  maxRssMB: number;
  avgHeapMB: number;
  maxHeapMB: number;
  avgCpuPercent: number;
  maxCpuPercent: number;
  sampleCount: number;
}

export async function getResourceMetricsHistory(
  hoursOrOptions: number | { hours?: number; startDate?: Date; endDate?: Date } = 24
): Promise<ResourceMetricsHistoryRow[]> {
  try {
    const options = typeof hoursOrOptions === 'number' ? { hours: hoursOrOptions } : hoursOrOptions;
    const { hours = 24, startDate, endDate } = options;

    const cutoff = startDate ?? (() => {
      const d = new Date();
      d.setUTCHours(d.getUTCHours() - hours);
      return d;
    })();

    let dbRows: ResourceMetricsHistoryRow[] = [];
    let query = pool.selectFrom('resource_metrics')
      .select([
        'bucket_start as bucketStart',
        'avg_rss_mb as avgRssMB',
        'max_rss_mb as maxRssMB',
        'avg_heap_mb as avgHeapMB',
        'max_heap_mb as maxHeapMB',
        'avg_cpu_percent as avgCpuPercent',
        'max_cpu_percent as maxCpuPercent',
        'sample_count as sampleCount'
      ])
      .where('bucket_start', '>=', cutoff)
      .orderBy('bucket_start', 'asc');

    if (endDate) {
      query = query.where('bucket_start', '<=', endDate);
    }

    dbRows = await query.execute();

    // Include current buffer
    const bufferAggregates = aggregateToBuckets(memoryBuffer);

    const merged = new Map<number, ResourceMetricsHistoryRow>();
    for (const row of dbRows) {
      merged.set(new Date(row.bucketStart).getTime(), row);
    }

    for (const agg of bufferAggregates) {
      const ts = agg.bucketStart.getTime();
      const existing = merged.get(ts);
      if (existing) {
        // Merge buffer data with existing DB data (likely for the most recent bucket)
        const totalCount = existing.sampleCount + agg.sampleCount;

        merged.set(ts, {
          bucketStart: agg.bucketStart,
          avgRssMB: weightedAvg(existing.avgRssMB, existing.sampleCount, agg.avgRssMB, agg.sampleCount),
          maxRssMB: Math.max(existing.maxRssMB, agg.maxRssMB),
          avgHeapMB: weightedAvg(existing.avgHeapMB, existing.sampleCount, agg.avgHeapMB, agg.sampleCount),
          maxHeapMB: Math.max(existing.maxHeapMB, agg.maxHeapMB),
          avgCpuPercent: weightedAvg(existing.avgCpuPercent, existing.sampleCount, agg.avgCpuPercent, agg.sampleCount),
          maxCpuPercent: Math.max(existing.maxCpuPercent, agg.maxCpuPercent),
          sampleCount: totalCount,
        });
      } else {
        merged.set(ts, {
          bucketStart: agg.bucketStart,
          avgRssMB: agg.avgRssMB,
          maxRssMB: agg.maxRssMB,
          avgHeapMB: agg.avgHeapMB,
          maxHeapMB: agg.maxHeapMB,
          avgCpuPercent: agg.avgCpuPercent,
          maxCpuPercent: agg.maxCpuPercent,
          sampleCount: agg.sampleCount,
        });
      }
    }

    return Array.from(merged.values())
      .filter(r => r.bucketStart >= cutoff && (!endDate || r.bucketStart <= endDate))
      .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());
  } catch (err) {
    logger.error({ err }, '[resourceMetrics] failed to get history');
    return [];
  }
}

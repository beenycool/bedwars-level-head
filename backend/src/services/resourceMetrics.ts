import { Mutex } from 'async-mutex';
import { pool } from './cache';
import { DatabaseType } from './database/adapter';
import os from 'os';

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
const MAX_BUFFER_SIZE = 12_000;
const RETENTION_DAYS = 30;

const bufferMutex = new Mutex();
const memoryBuffer: MemorySample[] = [];

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
      if (pool.type === DatabaseType.POSTGRESQL) {
        const res = await pool.query<{ sample_count: number, avg_rss_mb: number, max_rss_mb: number, min_rss_mb: number, p95_rss_mb: number, p99_rss_mb: number, avg_heap_mb: number, max_heap_mb: number, min_heap_mb: number, p95_heap_mb: number, p99_heap_mb: number, avg_cpu_percent: number, max_cpu_percent: number, min_cpu_percent: number, p95_cpu_percent: number, p99_cpu_percent: number }>(
          'SELECT * FROM resource_metrics WHERE bucket_start = $1',
          [aggregate.bucketStart]
        );
        existing = res.rows[0];
      } else {
        const res = await pool.query<any>(
          'SELECT * FROM resource_metrics WHERE bucket_start = @p1',
          [aggregate.bucketStart]
        );
        existing = res.rows[0];
      }

      if (!existing) {
        if (pool.type === DatabaseType.POSTGRESQL) {
          await pool.query(
            `INSERT INTO resource_metrics (
              bucket_start, avg_rss_mb, max_rss_mb, min_rss_mb, p95_rss_mb, p99_rss_mb,
              avg_heap_mb, max_heap_mb, min_heap_mb, p95_heap_mb, p99_heap_mb,
              avg_cpu_percent, max_cpu_percent, min_cpu_percent, p95_cpu_percent, p99_cpu_percent,
              sample_count
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              aggregate.bucketStart, aggregate.avgRssMB, aggregate.maxRssMB, aggregate.minRssMB, aggregate.p95RssMB, aggregate.p99RssMB,
              aggregate.avgHeapMB, aggregate.maxHeapMB, aggregate.minHeapMB, aggregate.p95HeapMB, aggregate.p99HeapMB,
              aggregate.avgCpuPercent, aggregate.maxCpuPercent, aggregate.minCpuPercent, aggregate.p95CpuPercent, aggregate.p99CpuPercent,
              aggregate.sampleCount,
            ]
          );
        } else {
          await pool.query(
            `INSERT INTO resource_metrics (
              bucket_start, avg_rss_mb, max_rss_mb, min_rss_mb, p95_rss_mb, p99_rss_mb,
              avg_heap_mb, max_heap_mb, min_heap_mb, p95_heap_mb, p99_heap_mb,
              avg_cpu_percent, max_cpu_percent, min_cpu_percent, p95_cpu_percent, p99_cpu_percent,
              sample_count
            ) VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13, @p14, @p15, @p16, @p17)`,
            [
              aggregate.bucketStart, aggregate.avgRssMB, aggregate.maxRssMB, aggregate.minRssMB, aggregate.p95_rss_mb, aggregate.p99_rss_mb,
              aggregate.avgHeapMB, aggregate.maxHeapMB, aggregate.minHeapMB, aggregate.p95HeapMB, aggregate.p99HeapMB,
              aggregate.avgCpuPercent, aggregate.maxCpuPercent, aggregate.minCpuPercent, aggregate.p95CpuPercent, aggregate.p99CpuPercent,
              aggregate.sampleCount,
            ]
          );
        }
      } else {
        const existingSampleCount = existing.sample_count;
        const newTotalCount = existingSampleCount + aggregate.sampleCount;

        const mergedAvgRssMB = weightedAvg(existing.avg_rss_mb, existingSampleCount, aggregate.avgRssMB, aggregate.sampleCount);
        const mergedMaxRssMB = Math.max(existing.max_rss_mb, aggregate.maxRssMB);
        const mergedMinRssMB = Math.min(existing.min_rss_mb, aggregate.min_rss_mb);

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

        if (pool.type === DatabaseType.POSTGRESQL) {
          await pool.query(
            `UPDATE resource_metrics SET
              avg_rss_mb = $1, max_rss_mb = $2, min_rss_mb = $3,
              p95_rss_mb = $4, p99_rss_mb = $5,
              avg_heap_mb = $6, max_heap_mb = $7, min_heap_mb = $8,
              p95_heap_mb = $9, p99_heap_mb = $10,
              avg_cpu_percent = $11, max_cpu_percent = $12, min_cpu_percent = $13,
              p95_cpu_percent = $14, p99_cpu_percent = $15,
              sample_count = $16
            WHERE bucket_start = $17`,
            [
              mergedAvgRssMB, mergedMaxRssMB, mergedMinRssMB,
              mergedP95RssMB, mergedP99RssMB,
              mergedAvgHeapMB, mergedMaxHeapMB, mergedMinHeapMB,
              mergedP95HeapMB, mergedP99HeapMB,
              mergedAvgCpuPercent, mergedMaxCpuPercent, mergedMinCpuPercent,
              mergedP95CpuPercent, mergedP99CpuPercent,
              newTotalCount,
              aggregate.bucketStart,
            ]
          );
        } else {
          await pool.query(
            `UPDATE resource_metrics SET
              avg_rss_mb = @p1, max_rss_mb = @p2, min_rss_mb = @p3,
              p95_rss_mb = @p4, p99_rss_mb = @p5,
              avg_heap_mb = @p6, max_heap_mb = @p7, min_heap_mb = @p8,
              p95_heap_mb = @p9, p99_heap_mb = @p10,
              avg_cpu_percent = @p11, max_cpu_percent = @p12, min_cpu_percent = @p13,
              p95_cpu_percent = @p14, p99_cpu_percent = @p15,
              sample_count = @p16
            WHERE bucket_start = @p17`,
            [
              mergedAvgRssMB, mergedMaxRssMB, mergedMinRssMB,
              mergedP95RssMB, mergedP99RssMB,
              mergedAvgHeapMB, mergedMaxHeapMB, mergedMinHeapMB,
              mergedP95HeapMB, mergedP99HeapMB,
              mergedAvgCpuPercent, mergedMaxCpuPercent, mergedMinCpuPercent,
              mergedP95CpuPercent, mergedP99CpuPercent,
              newTotalCount,
              aggregate.bucketStart,
            ]
          );
        }
      }
    }
  } catch (err) {
    console.error('[resourceMetrics] failed to persist aggregate', err);
    throw err;
  }
}

async function flushBuffer(): Promise<void> {
  const release = await bufferMutex.acquire();
  try {
    if (memoryBuffer.length === 0) return;

    const samples = [...memoryBuffer];
    const aggregates = aggregateToBuckets(samples);
    if (aggregates.length === 0) {
      memoryBuffer.length = 0;
      return;
    }

    try {
      await persistAggregate(aggregates);
      const maxPersistedTimestamp = Math.max(...samples.map(s => s.timestamp));
      const retainedSamples = memoryBuffer.filter(sample => sample.timestamp > maxPersistedTimestamp);
      memoryBuffer.splice(0, memoryBuffer.length, ...retainedSamples);
      const uniqueBuckets = aggregates.length;
      console.info(`[resourceMetrics] flushed ${samples.length} samples across ${uniqueBuckets} bucket${uniqueBuckets > 1 ? 's' : ''}`);
    } catch (error) {
      console.warn('Failed to flush resource metrics buffer, retaining for retry:', error);
    }
  } finally {
    release();
  }
}

async function pruneOldData(): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);

    if (pool.type === DatabaseType.POSTGRESQL) {
      const result = await pool.query('DELETE FROM resource_metrics WHERE bucket_start < $1', [cutoff]);
      if (result.rowCount > 0) {
        console.info(`[resourceMetrics] pruned ${result.rowCount} old records`);
      }
    } else {
      const result = await pool.query('DELETE FROM resource_metrics WHERE bucket_start < @p1', [cutoff]);
      if (result.rowCount > 0) {
        console.info(`[resourceMetrics] pruned ${result.rowCount} old records`);
      }
    }
  } catch (err) {
    console.error('[resourceMetrics] failed to prune old data', err);
  }
}

async function takeSample(): Promise<void> {
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

  const release = await bufferMutex.acquire();
  try {
    memoryBuffer.push(sample);

    if (memoryBuffer.length > MAX_BUFFER_SIZE) {
      memoryBuffer.splice(0, memoryBuffer.length - MAX_BUFFER_SIZE);
    }
  } finally {
    release();
  }
}

export async function initializeResourceMetrics(): Promise<void> {
  try {
    if (pool.type === DatabaseType.POSTGRESQL) {
      // Backward compatibility: rename hour_start to bucket_start if it exists
      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='resource_metrics' AND column_name='hour_start') THEN
            ALTER TABLE resource_metrics RENAME COLUMN hour_start TO bucket_start;
          END IF;
        END $$;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS resource_metrics (
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
        )
      `);
    } else {
      // For Azure SQL
      await pool.query(`
        IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[resource_metrics]') AND name = 'hour_start')
        EXEC sp_rename 'resource_metrics.hour_start', 'bucket_start', 'COLUMN';
      `);

      await pool.query(`
        IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[resource_metrics]') AND type in (N'U'))
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
        )
      `);
      await pool.query(`
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_resource_metrics_bucket')
        CREATE UNIQUE INDEX idx_resource_metrics_bucket ON resource_metrics (bucket_start)
      `);
    }
    console.info('[resourceMetrics] table is ready');
  } catch (err) {
    console.error('[resourceMetrics] failed to initialize table', err);
    throw err;
  }

  getCpuPercent();

  sampleInterval = setInterval(() => {
    void takeSample().catch(err => console.error('[resourceMetrics] sample error', err));
  }, SAMPLE_INTERVAL_MS);

  const now = new Date();
  const nextBucket = new Date(Math.ceil(now.getTime() / FLUSH_INTERVAL_MS) * FLUSH_INTERVAL_MS);
  const msUntilNextBucket = nextBucket.getTime() - now.getTime();

  alignmentTimeout = setTimeout(() => {
    void flushBuffer().catch(err => console.error('[resourceMetrics] flush error', err));
    void pruneOldData().catch(err => console.error('[resourceMetrics] prune error', err));
    flushInterval = setInterval(() => {
      void flushBuffer().catch(err => console.error('[resourceMetrics] flush error', err));
      void pruneOldData().catch(err => console.error('[resourceMetrics] prune error', err));
    }, FLUSH_INTERVAL_MS);
  }, msUntilNextBucket);

  console.info('[resourceMetrics] initialized');
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
  const release = await bufferMutex.acquire();
  let bufferSize: number;
  try {
    bufferSize = memoryBuffer.length;
  } finally {
    release();
  }

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

export async function getResourceMetricsHistory(hours: number = 24): Promise<ResourceMetricsHistoryRow[]> {
  try {
    const cutoff = new Date();
    cutoff.setUTCHours(cutoff.getUTCHours() - hours);

    let dbRows: ResourceMetricsHistoryRow[] = [];
    if (pool.type === DatabaseType.POSTGRESQL) {
      const result = await pool.query<any>(`
        SELECT 
          bucket_start as "bucketStart",
          avg_rss_mb as "avgRssMB",
          max_rss_mb as "maxRssMB",
          avg_heap_mb as "avgHeapMB",
          max_heap_mb as "maxHeapMB",
          avg_cpu_percent as "avgCpuPercent",
          max_cpu_percent as "maxCpuPercent",
          sample_count as "sampleCount"
        FROM resource_metrics
        WHERE bucket_start >= $1
        ORDER BY bucket_start ASC
      `, [cutoff]);
      dbRows = result.rows;
    } else {
      const result = await pool.query<any>(`
        SELECT 
          bucket_start as bucketStart,
          avg_rss_mb as avgRssMB,
          max_rss_mb as maxRssMB,
          avg_heap_mb as avgHeapMB,
          max_heap_mb as maxHeapMB,
          avg_cpu_percent as avgCpuPercent,
          max_cpu_percent as maxCpuPercent,
          sample_count as sampleCount
        FROM resource_metrics
        WHERE bucket_start >= @p1
        ORDER BY bucket_start ASC
      `, [cutoff]);
      dbRows = result.rows;
    }

    // Include current buffer
    const release = await bufferMutex.acquire();
    let bufferAggregates: BucketAggregate[] = [];
    try {
      bufferAggregates = aggregateToBuckets(memoryBuffer);
    } finally {
      release();
    }

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
      .filter(r => r.bucketStart >= cutoff)
      .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());
  } catch (err) {
    console.error('[resourceMetrics] failed to get history', err);
    return [];
  }
}

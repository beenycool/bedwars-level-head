import { Mutex } from 'async-mutex';
import { pool } from './cache';
import { DatabaseType } from './database/adapter';
import os from 'os';
import { logger } from '../util/logger';

interface MemorySample { timestamp: number; rssMB: number; heapMB: number; heapTotalMB: number; externalMB: number; cpuPercent: number; }
interface BucketAggregate { bucketStart: Date; avgRssMB: number; maxRssMB: number; minRssMB: number; p95RssMB: number; p99RssMB: number; avgHeapMB: number; maxHeapMB: number; minHeapMB: number; p95HeapMB: number; p99HeapMB: number; avgCpuPercent: number; maxCpuPercent: number; minCpuPercent: number; p95CpuPercent: number; p99CpuPercent: number; sampleCount: number; }

const SAMPLE_INTERVAL_MS = 30_000;
const FLUSH_INTERVAL_MS = 60 * 1000;
const BUCKET_INTERVAL_MS = 60 * 1000;
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
  const now = Date.now(); const cur = process.cpuUsage();
  if (!lastCpuUsage || lastCpuCheckTime === 0) { lastCpuUsage = cur; lastCpuCheckTime = now; return 0; }
  const uDiff = cur.user - lastCpuUsage.user; const sDiff = cur.system - lastCpuUsage.system;
  const elap = now - lastCpuCheckTime; lastCpuUsage = cur; lastCpuCheckTime = now;
  if (elap <= 0) return 0;
  const totMicros = uDiff + sDiff; const elapMicros = elap * 1000; const nCpus = Math.max(1, os.cpus().length);
  return Math.min(100, (totMicros / elapMicros) * 100 / nCpus);
}

function calculatePercentile(sorted: number[], perc: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((perc / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

const arrMax = (arr: number[]) => arr.reduce((a, b) => Math.max(a, b), -Infinity);
const arrMin = (arr: number[]) => arr.reduce((a, b) => Math.min(a, b), Infinity);
const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
const avg = (arr: number[]) => arr.length > 0 ? sum(arr) / arr.length : 0;

function getBucketStart(ts: number): Date {
  return new Date(Math.floor(ts / BUCKET_INTERVAL_MS) * BUCKET_INTERVAL_MS);
}

function aggregateToBuckets(samples: MemorySample[]): BucketAggregate[] {
  const buckets = new Map<string, MemorySample[]>();
  for (const s of samples) {
    const k = getBucketStart(s.timestamp).toISOString();
    if (!buckets.has(k)) buckets.set(k, []); buckets.get(k)!.push(s);
  }
  const aggregates: BucketAggregate[] = [];
  for (const bSamples of buckets.values()) {
    const rss = bSamples.map(s => s.rssMB).sort((a, b) => a - b);
    const heap = bSamples.map(s => s.heapMB).sort((a, b) => a - b);
    const cpu = bSamples.map(s => s.cpuPercent).sort((a, b) => a - b);
    aggregates.push({
      bucketStart: getBucketStart(bSamples[0].timestamp),
      avgRssMB: avg(rss), maxRssMB: rss.length > 0 ? arrMax(rss) : 0, minRssMB: rss.length > 0 ? arrMin(rss) : 0, p95RssMB: calculatePercentile(rss, 95), p99RssMB: calculatePercentile(rss, 99),
      avgHeapMB: avg(heap), maxHeapMB: heap.length > 0 ? arrMax(heap) : 0, minHeapMB: heap.length > 0 ? arrMin(heap) : 0, p95HeapMB: calculatePercentile(heap, 95), p99HeapMB: calculatePercentile(heap, 99),
      avgCpuPercent: avg(cpu), maxCpuPercent: cpu.length > 0 ? arrMax(cpu) : 0, minCpuPercent: cpu.length > 0 ? arrMin(cpu) : 0, p95CpuPercent: calculatePercentile(cpu, 95), p99CpuPercent: calculatePercentile(cpu, 99),
      sampleCount: bSamples.length,
    });
  }
  return aggregates.sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());
}

async function persistAggregate(aggregates: BucketAggregate[]): Promise<void> {
  try {
    for (const aggregate of aggregates) {
      let existing;
      const res = await pool.query<any>('SELECT * FROM resource_metrics WHERE bucket_start = $1', [aggregate.bucketStart]);
      existing = res.rows[0];

      if (!existing) {
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
      }
    }
  } catch (err) {
    logger.error('[resourceMetrics] failed to persist aggregate', err);
    throw err;
  }
}

async function flushBuffer(): Promise<void> {
  const rel = await bufferMutex.acquire();
  try {
    if (memoryBuffer.length === 0) return;
    const samples = [...memoryBuffer]; const aggregates = aggregateToBuckets(samples);
    if (aggregates.length === 0) { memoryBuffer.length = 0; return; }
    try {
      await persistAggregate(aggregates);
      const maxPersistedTimestamp = Math.max(...samples.map(s => s.timestamp));
      const retainedSamples = memoryBuffer.filter(sample => sample.timestamp > maxPersistedTimestamp);
      memoryBuffer.splice(0, memoryBuffer.length, ...retainedSamples);
      const uniqueBuckets = aggregates.length;
      logger.info(`[resourceMetrics] flushed ${samples.length} samples across ${uniqueBuckets} bucket${uniqueBuckets > 1 ? 's' : ''}`);
    } catch (error) {
      logger.warn('Failed to flush resource metrics buffer, retaining for retry:', error);
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
        logger.info(`[resourceMetrics] pruned ${result.rowCount} old records`);
      }
    } else {
      const result = await pool.query('DELETE FROM resource_metrics WHERE bucket_start < @p1', [cutoff]);
      if (result.rowCount > 0) {
        logger.info(`[resourceMetrics] pruned ${result.rowCount} old records`);
      }
    }
  } catch (err) {
    logger.error('[resourceMetrics] failed to prune old data', err);
  }
}

async function takeSample(): Promise<void> {
  const mem = process.memoryUsage(); const cpu = getCpuPercent();
  const sample: MemorySample = { timestamp: Date.now(), rssMB: mem.rss / 1048576, heapMB: mem.heapUsed / 1048576, heapTotalMB: mem.heapTotal / 1048576, externalMB: mem.external / 1048576, cpuPercent: cpu };
  const rel = await bufferMutex.acquire(); try { memoryBuffer.push(sample); if (memoryBuffer.length > MAX_BUFFER_SIZE) memoryBuffer.splice(0, memoryBuffer.length - MAX_BUFFER_SIZE); } finally { rel(); }
}

export async function initializeResourceMetrics(): Promise<void> {
  try {
    if (pool.type === DatabaseType.POSTGRESQL) {
      const check = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='resource_metrics' AND column_name='hour_start'`);
      if (check.rowCount > 0) { try { await pool.query('ALTER TABLE resource_metrics RENAME COLUMN hour_start TO bucket_start'); } catch (e: any) { if (e.code !== '42703') throw e; } }
    } else {
      await pool.query(`IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[resource_metrics]') AND name = 'hour_start') EXEC sp_rename 'resource_metrics.hour_start', 'bucket_start', 'COLUMN';`);
    }
    logger.info('[resourceMetrics] table is ready');
  } catch (err) {
    logger.error('[resourceMetrics] failed to initialize table', err);
    throw err;
  }

  getCpuPercent();

  sampleInterval = setInterval(() => {
    void takeSample().catch(err => logger.error('[resourceMetrics] sample error', err));
  }, SAMPLE_INTERVAL_MS);

  const now = new Date();
  const nextBucket = new Date(Math.ceil(now.getTime() / FLUSH_INTERVAL_MS) * FLUSH_INTERVAL_MS);
  const msUntilNextBucket = nextBucket.getTime() - now.getTime();

  alignmentTimeout = setTimeout(() => {
    void flushBuffer().catch(err => logger.error('[resourceMetrics] flush error', err));
    void pruneOldData().catch(err => logger.error('[resourceMetrics] prune error', err));
    flushInterval = setInterval(() => {
      void flushBuffer().catch(err => logger.error('[resourceMetrics] flush error', err));
      void pruneOldData().catch(err => logger.error('[resourceMetrics] prune error', err));
    }, FLUSH_INTERVAL_MS);
  }, msUntilNextBucket);

  logger.info('[resourceMetrics] initialized');
}

export function stopResourceMetrics(): void {
  if (sampleInterval) clearInterval(sampleInterval); if (flushInterval) clearInterval(flushInterval); if (alignmentTimeout) clearTimeout(alignmentTimeout);
}

export async function flushResourceMetricsOnShutdown(): Promise<void> { await flushBuffer(); }

export async function getCurrentResourceMetrics(): Promise<any> {
  const mem = process.memoryUsage(); const cpu = getCpuPercent();
  const rel = await bufferMutex.acquire(); let bSize; try { bSize = memoryBuffer.length; } finally { rel(); }
  return { rssMB: Math.round(mem.rss/10485.76)/100, heapMB: Math.round(mem.heapUsed/10485.76)/100, heapTotalMB: Math.round(mem.heapTotal/10485.76)/100, externalMB: Math.round(mem.external/10485.76)/100, cpuPercent: Math.round(cpu*100)/100, bufferSize: bSize };
}

export async function getResourceMetricsHistory(options: any = {}): Promise<any[]> {
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
    const query = `
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
        ${endDate ? 'AND bucket_start <= $2' : ''}
        ORDER BY bucket_start ASC
      `;
      const params: any[] = [cutoff];
      if (endDate) params.push(endDate);
      const result = await pool.query<any>(query, params);
      dbRows = result.rows;

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
        merged.set(ts, { bucketStart: agg.bucketStart, avgRssMB: agg.avgRssMB, maxRssMB: agg.maxRssMB, avgHeapMB: agg.avgHeapMB, maxHeapMB: agg.maxHeapMB, avgCpuPercent: agg.avgCpuPercent, maxCpuPercent: agg.maxCpuPercent, sampleCount: agg.sampleCount });
      }
    }

    return Array.from(merged.values())
      .filter(r => r.bucketStart >= cutoff && (!endDate || r.bucketStart <= endDate))
      .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());
  } catch (err) {
    logger.error('[resourceMetrics] failed to get history', err);
    return [];
  }
}

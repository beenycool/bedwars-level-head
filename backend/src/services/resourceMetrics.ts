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

interface HourlyAggregate {
  hourStart: Date;
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
const FLUSH_INTERVAL_MS = 60 * 60 * 1000;
const MAX_BUFFER_SIZE = 12_000;
const RETENTION_DAYS = 30;

const bufferMutex = new Mutex();
const memoryBuffer: MemorySample[] = [];

let lastCpuUsage: NodeJS.CpuUsage | null = null;
let lastCpuCheckTime = 0;
let sampleInterval: NodeJS.Timeout | null = null;
let flushInterval: NodeJS.Timeout | null = null;
let alignmentTimeout: NodeJS.Timeout | null = null;

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

function getHourStart(timestamp: number): Date {
  const date = new Date(timestamp);
  date.setUTCMinutes(0, 0, 0);
  date.setUTCMilliseconds(0);
  return date;
}

function aggregateHourly(samples: MemorySample[]): HourlyAggregate[] {
  const buckets = new Map<string, MemorySample[]>();

  for (const sample of samples) {
    const hourKey = getHourStart(sample.timestamp).toISOString();
    if (!buckets.has(hourKey)) {
      buckets.set(hourKey, []);
    }
    buckets.get(hourKey)!.push(sample);
  }

  const aggregates: HourlyAggregate[] = [];
  for (const bucketSamples of buckets.values()) {
    const rssValues = bucketSamples.map(s => s.rssMB).sort((a, b) => a - b);
    const heapValues = bucketSamples.map(s => s.heapMB).sort((a, b) => a - b);
    const cpuValues = bucketSamples.map(s => s.cpuPercent).sort((a, b) => a - b);

    aggregates.push({
      hourStart: getHourStart(bucketSamples[0].timestamp),
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

  return aggregates;
}

async function persistAggregate(aggregates: HourlyAggregate[]): Promise<void> {
  try {
    for (const aggregate of aggregates) {
      if (pool.type === DatabaseType.POSTGRESQL) {
        const existingResult = await pool.query(
          `SELECT * FROM resource_metrics WHERE hour_start = $1`,
          [aggregate.hourStart]
        );

        if (existingResult.rows.length === 0) {
          await pool.query(
            `INSERT INTO resource_metrics (
              hour_start, avg_rss_mb, max_rss_mb, min_rss_mb, p95_rss_mb, p99_rss_mb,
              avg_heap_mb, max_heap_mb, min_heap_mb, p95_heap_mb, p99_heap_mb,
              avg_cpu_percent, max_cpu_percent, min_cpu_percent, p95_cpu_percent, p99_cpu_percent,
              sample_count
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              aggregate.hourStart,
              aggregate.avgRssMB, aggregate.maxRssMB, aggregate.minRssMB, aggregate.p95RssMB, aggregate.p99RssMB,
              aggregate.avgHeapMB, aggregate.maxHeapMB, aggregate.minHeapMB, aggregate.p95HeapMB, aggregate.p99HeapMB,
              aggregate.avgCpuPercent, aggregate.maxCpuPercent, aggregate.minCpuPercent, aggregate.p95CpuPercent, aggregate.p99CpuPercent,
              aggregate.sampleCount,
            ]
          );
        } else {
          const existing = existingResult.rows[0];
          const existingSampleCount = existing.sample_count as number;
          const newTotalCount = existingSampleCount + aggregate.sampleCount;

          const weightedAvg = (oldAvg: number, oldCount: number, newAvg: number, newCount: number) => {
            return (oldAvg * oldCount + newAvg * newCount) / (oldCount + newCount);
          };

          const mergedAvgRssMB = weightedAvg(existing.avg_rss_mb as number, existingSampleCount, aggregate.avgRssMB, aggregate.sampleCount);
          const mergedAvgHeapMB = weightedAvg(existing.avg_heap_mb as number, existingSampleCount, aggregate.avgHeapMB, aggregate.sampleCount);
          const mergedAvgCpuPercent = weightedAvg(existing.avg_cpu_percent as number, existingSampleCount, aggregate.avgCpuPercent, aggregate.sampleCount);

          const mergedMaxRssMB = Math.max(existing.max_rss_mb as number, aggregate.maxRssMB);
          const mergedMaxHeapMB = Math.max(existing.max_heap_mb as number, aggregate.maxHeapMB);
          const mergedMaxCpuPercent = Math.max(existing.max_cpu_percent as number, aggregate.maxCpuPercent);

          const mergedMinRssMB = Math.min(existing.min_rss_mb as number, aggregate.minRssMB);
          const mergedMinHeapMB = Math.min(existing.min_heap_mb as number, aggregate.minHeapMB);
          const mergedMinCpuPercent = Math.min(existing.min_cpu_percent as number, aggregate.minCpuPercent);

          const mergedP95RssMB = weightedAvg(existing.p95_rss_mb as number, existingSampleCount, aggregate.p95RssMB, aggregate.sampleCount);
          const mergedP99RssMB = weightedAvg(existing.p99_rss_mb as number, existingSampleCount, aggregate.p99RssMB, aggregate.sampleCount);
          const mergedP95HeapMB = weightedAvg(existing.p95_heap_mb as number, existingSampleCount, aggregate.p95HeapMB, aggregate.sampleCount);
          const mergedP99HeapMB = weightedAvg(existing.p99_heap_mb as number, existingSampleCount, aggregate.p99HeapMB, aggregate.sampleCount);
          const mergedP95CpuPercent = weightedAvg(existing.p95_cpu_percent as number, existingSampleCount, aggregate.p95CpuPercent, aggregate.sampleCount);
          const mergedP99CpuPercent = weightedAvg(existing.p99_cpu_percent as number, existingSampleCount, aggregate.p99CpuPercent, aggregate.sampleCount);

          await pool.query(
            `UPDATE resource_metrics SET
              avg_rss_mb = $1, max_rss_mb = $2, min_rss_mb = $3,
              p95_rss_mb = $4, p99_rss_mb = $5,
              avg_heap_mb = $6, max_heap_mb = $7, min_heap_mb = $8,
              p95_heap_mb = $9, p99_heap_mb = $10,
              avg_cpu_percent = $11, max_cpu_percent = $12, min_cpu_percent = $13,
              p95_cpu_percent = $14, p99_cpu_percent = $15,
              sample_count = $16
            WHERE hour_start = $17`,
            [
              mergedAvgRssMB, mergedMaxRssMB, mergedMinRssMB,
              mergedP95RssMB, mergedP99RssMB,
              mergedAvgHeapMB, mergedMaxHeapMB, mergedMinHeapMB,
              mergedP95HeapMB, mergedP99HeapMB,
              mergedAvgCpuPercent, mergedMaxCpuPercent, mergedMinCpuPercent,
              mergedP95CpuPercent, mergedP99CpuPercent,
              newTotalCount,
              aggregate.hourStart,
            ]
          );
        }
      } else {
        const existingResult = await pool.query(
          `SELECT * FROM resource_metrics WHERE hour_start = @p1`,
          [aggregate.hourStart]
        );

        if (existingResult.rows.length === 0) {
          await pool.query(
            `INSERT INTO resource_metrics (
              hour_start, avg_rss_mb, max_rss_mb, min_rss_mb, p95_rss_mb, p99_rss_mb,
              avg_heap_mb, max_heap_mb, min_heap_mb, p95_heap_mb, p99_heap_mb,
              avg_cpu_percent, max_cpu_percent, min_cpu_percent, p95_cpu_percent, p99_cpu_percent,
              sample_count
            ) VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13, @p14, @p15, @p16, @p17)`,
            [
              aggregate.hourStart,
              aggregate.avgRssMB, aggregate.maxRssMB, aggregate.minRssMB, aggregate.p95RssMB, aggregate.p99RssMB,
              aggregate.avgHeapMB, aggregate.maxHeapMB, aggregate.minHeapMB, aggregate.p95HeapMB, aggregate.p99HeapMB,
              aggregate.avgCpuPercent, aggregate.maxCpuPercent, aggregate.minCpuPercent, aggregate.p95CpuPercent, aggregate.p99CpuPercent,
              aggregate.sampleCount,
            ]
          );
        } else {
          const existing = existingResult.rows[0];
          const existingSampleCount = existing.sample_count as number;
          const newTotalCount = existingSampleCount + aggregate.sampleCount;

          const weightedAvg = (oldAvg: number, oldCount: number, newAvg: number, newCount: number) => {
            return (oldAvg * oldCount + newAvg * newCount) / (oldCount + newCount);
          };

          const mergedAvgRssMB = weightedAvg(existing.avg_rss_mb as number, existingSampleCount, aggregate.avgRssMB, aggregate.sampleCount);
          const mergedAvgHeapMB = weightedAvg(existing.avg_heap_mb as number, existingSampleCount, aggregate.avgHeapMB, aggregate.sampleCount);
          const mergedAvgCpuPercent = weightedAvg(existing.avg_cpu_percent as number, existingSampleCount, aggregate.avgCpuPercent, aggregate.sampleCount);

          const mergedMaxRssMB = Math.max(existing.max_rss_mb as number, aggregate.maxRssMB);
          const mergedMaxHeapMB = Math.max(existing.max_heap_mb as number, aggregate.maxHeapMB);
          const mergedMaxCpuPercent = Math.max(existing.max_cpu_percent as number, aggregate.maxCpuPercent);

          const mergedMinRssMB = Math.min(existing.min_rss_mb as number, aggregate.minRssMB);
          const mergedMinHeapMB = Math.min(existing.min_heap_mb as number, aggregate.minHeapMB);
          const mergedMinCpuPercent = Math.min(existing.min_cpu_percent as number, aggregate.minCpuPercent);

          const mergedP95RssMB = weightedAvg(existing.p95_rss_mb as number, existingSampleCount, aggregate.p95RssMB, aggregate.sampleCount);
          const mergedP99RssMB = weightedAvg(existing.p99_rss_mb as number, existingSampleCount, aggregate.p99RssMB, aggregate.sampleCount);
          const mergedP95HeapMB = weightedAvg(existing.p95_heap_mb as number, existingSampleCount, aggregate.p95HeapMB, aggregate.sampleCount);
          const mergedP99HeapMB = weightedAvg(existing.p99_heap_mb as number, existingSampleCount, aggregate.p99HeapMB, aggregate.sampleCount);
          const mergedP95CpuPercent = weightedAvg(existing.p95_cpu_percent as number, existingSampleCount, aggregate.p95CpuPercent, aggregate.sampleCount);
          const mergedP99CpuPercent = weightedAvg(existing.p99_cpu_percent as number, existingSampleCount, aggregate.p99CpuPercent, aggregate.sampleCount);

          await pool.query(
            `UPDATE resource_metrics SET
              avg_rss_mb = @p1, max_rss_mb = @p2, min_rss_mb = @p3,
              p95_rss_mb = @p4, p99_rss_mb = @p5,
              avg_heap_mb = @p6, max_heap_mb = @p7, min_heap_mb = @p8,
              p95_heap_mb = @p9, p99_heap_mb = @p10,
              avg_cpu_percent = @p11, max_cpu_percent = @p12, min_cpu_percent = @p13,
              p95_cpu_percent = @p14, p99_cpu_percent = @p15,
              sample_count = @p16
            WHERE hour_start = @p17`,
            [
              mergedAvgRssMB, mergedMaxRssMB, mergedMinRssMB,
              mergedP95RssMB, mergedP99RssMB,
              mergedAvgHeapMB, mergedMaxHeapMB, mergedMinHeapMB,
              mergedP95HeapMB, mergedP99HeapMB,
              mergedAvgCpuPercent, mergedMaxCpuPercent, mergedMinCpuPercent,
              mergedP95CpuPercent, mergedP99CpuPercent,
              newTotalCount,
              aggregate.hourStart,
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
    const aggregates = aggregateHourly(samples);
    if (aggregates.length === 0) {
      memoryBuffer.length = 0;
      return;
    }

    try {
      await persistAggregate(aggregates);
      const maxPersistedTimestamp = Math.max(...samples.map(s => s.timestamp));
      const retainedSamples = memoryBuffer.filter(sample => sample.timestamp > maxPersistedTimestamp);
      memoryBuffer.splice(0, memoryBuffer.length, ...retainedSamples);
      const uniqueHours = aggregates.length;
      console.info(`[resourceMetrics] flushed ${samples.length} samples across ${uniqueHours} hour${uniqueHours > 1 ? 's' : ''}`);
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
      const result = await pool.query('DELETE FROM resource_metrics WHERE hour_start < $1', [cutoff]);
      if (result.rowCount > 0) {
        console.info(`[resourceMetrics] pruned ${result.rowCount} old records`);
      }
    } else {
      const result = await pool.query('DELETE FROM resource_metrics WHERE hour_start < @p1', [cutoff]);
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
      await pool.query(`
        CREATE TABLE IF NOT EXISTS resource_metrics (
          id BIGSERIAL PRIMARY KEY,
          hour_start TIMESTAMPTZ NOT NULL UNIQUE,
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
      await pool.query(`
        IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[resource_metrics]') AND type in (N'U'))
        CREATE TABLE resource_metrics (
          id BIGINT IDENTITY(1,1) PRIMARY KEY,
          hour_start DATETIME2 NOT NULL,
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
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_resource_metrics_hour')
        CREATE UNIQUE INDEX idx_resource_metrics_hour ON resource_metrics (hour_start)
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
  const nextHour = new Date(now);
  nextHour.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
  const msUntilNextHour = nextHour.getTime() - now.getTime();

  alignmentTimeout = setTimeout(() => {
    void flushBuffer().catch(err => console.error('[resourceMetrics] flush error', err));
    void pruneOldData().catch(err => console.error('[resourceMetrics] prune error', err));
    flushInterval = setInterval(() => {
      void flushBuffer().catch(err => console.error('[resourceMetrics] flush error', err));
      void pruneOldData().catch(err => console.error('[resourceMetrics] prune error', err));
    }, FLUSH_INTERVAL_MS);
  }, msUntilNextHour);

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
  hourStart: Date;
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

    let result;
    if (pool.type === DatabaseType.POSTGRESQL) {
      result = await pool.query<ResourceMetricsHistoryRow>(`
        SELECT 
          hour_start as "hourStart",
          avg_rss_mb as "avgRssMB",
          max_rss_mb as "maxRssMB",
          avg_heap_mb as "avgHeapMB",
          max_heap_mb as "maxHeapMB",
          avg_cpu_percent as "avgCpuPercent",
          max_cpu_percent as "maxCpuPercent",
          sample_count as "sampleCount"
        FROM resource_metrics
        WHERE hour_start >= $1
        ORDER BY hour_start ASC
      `, [cutoff]);
    } else {
      result = await pool.query<ResourceMetricsHistoryRow>(`
        SELECT 
          hour_start as hourStart,
          avg_rss_mb as avgRssMB,
          max_rss_mb as maxRssMB,
          avg_heap_mb as avgHeapMB,
          max_heap_mb as maxHeapMB,
          avg_cpu_percent as avgCpuPercent,
          max_cpu_percent as maxCpuPercent,
          sample_count as sampleCount
        FROM resource_metrics
        WHERE hour_start >= @p1
        ORDER BY hour_start ASC
      `, [cutoff]);
    }

    return result.rows;
  } catch (err) {
    console.error('[resourceMetrics] failed to get history', err);
    return [];
  }
}

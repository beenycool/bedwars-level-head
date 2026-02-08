import { Mutex } from 'async-mutex';
import { pool } from './cache';
import { DatabaseType } from './database/adapter';

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
  const numCpus = Math.max(1, require('os').cpus().length);

  return Math.min(100, (totalMicroseconds / elapsedMicroseconds) * 100 / numCpus);
}

function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

function aggregateHourly(samples: MemorySample[]): HourlyAggregate {
  const hourStart = new Date();
  hourStart.setMinutes(0, 0, 0);
  hourStart.setMilliseconds(0);

  const rssValues = samples.map(s => s.rssMB).sort((a, b) => a - b);
  const heapValues = samples.map(s => s.heapMB).sort((a, b) => a - b);
  const cpuValues = samples.map(s => s.cpuPercent).sort((a, b) => a - b);

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => arr.length > 0 ? sum(arr) / arr.length : 0;

  return {
    hourStart,
    avgRssMB: avg(rssValues),
    maxRssMB: Math.max(...rssValues, 0),
    minRssMB: Math.min(...rssValues, Infinity),
    p95RssMB: calculatePercentile(rssValues, 95),
    p99RssMB: calculatePercentile(rssValues, 99),
    avgHeapMB: avg(heapValues),
    maxHeapMB: Math.max(...heapValues, 0),
    minHeapMB: Math.min(...heapValues, Infinity),
    p95HeapMB: calculatePercentile(heapValues, 95),
    p99HeapMB: calculatePercentile(heapValues, 99),
    avgCpuPercent: avg(cpuValues),
    maxCpuPercent: Math.max(...cpuValues, 0),
    minCpuPercent: Math.min(...cpuValues, Infinity),
    p95CpuPercent: calculatePercentile(cpuValues, 95),
    p99CpuPercent: calculatePercentile(cpuValues, 99),
    sampleCount: samples.length,
  };
}

async function persistAggregate(aggregate: HourlyAggregate): Promise<void> {
  try {
    if (pool.type === DatabaseType.POSTGRESQL) {
      await pool.query(
        `INSERT INTO resource_metrics (
          hour_start, avg_rss_mb, max_rss_mb, min_rss_mb, p95_rss_mb, p99_rss_mb,
          avg_heap_mb, max_heap_mb, min_heap_mb, p95_heap_mb, p99_heap_mb,
          avg_cpu_percent, max_cpu_percent, min_cpu_percent, p95_cpu_percent, p99_cpu_percent,
          sample_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (hour_start) DO UPDATE SET
          avg_rss_mb = EXCLUDED.avg_rss_mb,
          max_rss_mb = EXCLUDED.max_rss_mb,
          min_rss_mb = EXCLUDED.min_rss_mb,
          p95_rss_mb = EXCLUDED.p95_rss_mb,
          p99_rss_mb = EXCLUDED.p99_rss_mb,
          avg_heap_mb = EXCLUDED.avg_heap_mb,
          max_heap_mb = EXCLUDED.max_heap_mb,
          min_heap_mb = EXCLUDED.min_heap_mb,
          p95_heap_mb = EXCLUDED.p95_heap_mb,
          p99_heap_mb = EXCLUDED.p99_heap_mb,
          avg_cpu_percent = EXCLUDED.avg_cpu_percent,
          max_cpu_percent = EXCLUDED.max_cpu_percent,
          min_cpu_percent = EXCLUDED.min_cpu_percent,
          p95_cpu_percent = EXCLUDED.p95_cpu_percent,
          p99_cpu_percent = EXCLUDED.p99_cpu_percent,
          sample_count = EXCLUDED.sample_count`,
        [
          aggregate.hourStart,
          aggregate.avgRssMB, aggregate.maxRssMB, aggregate.minRssMB, aggregate.p95RssMB, aggregate.p99RssMB,
          aggregate.avgHeapMB, aggregate.maxHeapMB, aggregate.minHeapMB, aggregate.p95HeapMB, aggregate.p99HeapMB,
          aggregate.avgCpuPercent, aggregate.maxCpuPercent, aggregate.minCpuPercent, aggregate.p95CpuPercent, aggregate.p99CpuPercent,
          aggregate.sampleCount,
        ]
      );
    } else {
      await pool.query(
        `MERGE resource_metrics AS target
         USING (SELECT 
           @p1 AS hour_start, @p2 AS avg_rss_mb, @p3 AS max_rss_mb, @p4 AS min_rss_mb, @p5 AS p95_rss_mb, @p6 AS p99_rss_mb,
           @p7 AS avg_heap_mb, @p8 AS max_heap_mb, @p9 AS min_heap_mb, @p10 AS p95_heap_mb, @p11 AS p99_heap_mb,
           @p12 AS avg_cpu_percent, @p13 AS max_cpu_percent, @p14 AS min_cpu_percent, @p15 AS p95_cpu_percent, @p16 AS p99_cpu_percent,
           @p17 AS sample_count
         ) AS source
         ON (target.hour_start = source.hour_start)
         WHEN MATCHED THEN
           UPDATE SET
             avg_rss_mb = source.avg_rss_mb, max_rss_mb = source.max_rss_mb, min_rss_mb = source.min_rss_mb,
             p95_rss_mb = source.p95_rss_mb, p99_rss_mb = source.p99_rss_mb,
             avg_heap_mb = source.avg_heap_mb, max_heap_mb = source.max_heap_mb, min_heap_mb = source.min_heap_mb,
             p95_heap_mb = source.p95_heap_mb, p99_heap_mb = source.p99_heap_mb,
             avg_cpu_percent = source.avg_cpu_percent, max_cpu_percent = source.max_cpu_percent, min_cpu_percent = source.min_cpu_percent,
             p95_cpu_percent = source.p95_cpu_percent, p99_cpu_percent = source.p99_cpu_percent,
             sample_count = source.sample_count
         WHEN NOT MATCHED THEN
           INSERT (hour_start, avg_rss_mb, max_rss_mb, min_rss_mb, p95_rss_mb, p99_rss_mb,
             avg_heap_mb, max_heap_mb, min_heap_mb, p95_heap_mb, p99_heap_mb,
             avg_cpu_percent, max_cpu_percent, min_cpu_percent, p95_cpu_percent, p99_cpu_percent, sample_count)
           VALUES (source.hour_start, source.avg_rss_mb, source.max_rss_mb, source.min_rss_mb, source.p95_rss_mb, source.p99_rss_mb,
             source.avg_heap_mb, source.max_heap_mb, source.min_heap_mb, source.p95_heap_mb, source.p99_heap_mb,
             source.avg_cpu_percent, source.max_cpu_percent, source.min_cpu_percent, source.p95_cpu_percent, source.p99_cpu_percent,
             source.sample_count);`,
        [
          aggregate.hourStart,
          aggregate.avgRssMB, aggregate.maxRssMB, aggregate.minRssMB, aggregate.p95RssMB, aggregate.p99RssMB,
          aggregate.avgHeapMB, aggregate.maxHeapMB, aggregate.minHeapMB, aggregate.p95HeapMB, aggregate.p99HeapMB,
          aggregate.avgCpuPercent, aggregate.maxCpuPercent, aggregate.minCpuPercent, aggregate.p95CpuPercent, aggregate.p99CpuPercent,
          aggregate.sampleCount,
        ]
      );
    }
  } catch (err) {
    console.error('[resourceMetrics] failed to persist aggregate', err);
  }
}

async function flushBuffer(): Promise<void> {
  const release = await bufferMutex.acquire();
  try {
    if (memoryBuffer.length === 0) return;

    const aggregate = aggregateHourly(memoryBuffer);
    await persistAggregate(aggregate);

    const sampleCount = memoryBuffer.length;
    memoryBuffer.length = 0;
    console.info(`[resourceMetrics] flushed ${sampleCount} samples for hour ${aggregate.hourStart.toISOString()}`);
  } finally {
    release();
  }
}

async function pruneOldData(): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

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
      await pool.query('CREATE INDEX IF NOT EXISTS idx_resource_metrics_hour ON resource_metrics (hour_start)');
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

  sampleInterval = setInterval(() => {
    void takeSample().catch(err => console.error('[resourceMetrics] sample error', err));
  }, SAMPLE_INTERVAL_MS);

  flushInterval = setInterval(() => {
    void flushBuffer().catch(err => console.error('[resourceMetrics] flush error', err));
    void pruneOldData().catch(err => console.error('[resourceMetrics] prune error', err));
  }, FLUSH_INTERVAL_MS);

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
  const release = await bufferMutex.acquire();
  try {
    const memUsage = process.memoryUsage();
    const cpuPercent = getCpuPercent();

    return {
      rssMB: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100,
      heapMB: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
      externalMB: Math.round(memUsage.external / 1024 / 1024 * 100) / 100,
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      bufferSize: memoryBuffer.length,
    };
  } finally {
    release();
  }
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
    cutoff.setHours(cutoff.getHours() - hours);

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

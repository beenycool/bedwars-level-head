import { Mutex } from 'async-mutex';
import { pool } from './cache';
import { DatabaseType } from './database/adapter';
import os from 'os';

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
    for (const agg of aggregates) {
      const res = await pool.query<any>(`SELECT * FROM resource_metrics WHERE bucket_start = ${pool.getPlaceholder(1)}`, [agg.bucketStart]);
      const existing = res.rows[0];
      if (!existing) {
        const cols = ['bucket_start', 'avg_rss_mb', 'max_rss_mb', 'min_rss_mb', 'p95_rss_mb', 'p99_rss_mb', 'avg_heap_mb', 'max_heap_mb', 'min_heap_mb', 'p95_heap_mb', 'p99_heap_mb', 'avg_cpu_percent', 'max_cpu_percent', 'min_cpu_percent', 'p95_cpu_percent', 'p99_cpu_percent', 'sample_count'];
        const vals = [agg.bucketStart, agg.avgRssMB, agg.maxRssMB, agg.minRssMB, agg.p95RssMB, agg.p99RssMB, agg.avgHeapMB, agg.maxHeapMB, agg.minHeapMB, agg.p95HeapMB, agg.p99HeapMB, agg.avgCpuPercent, agg.maxCpuPercent, agg.minCpuPercent, agg.p95CpuPercent, agg.p99CpuPercent, agg.sampleCount];
        const placeholders = vals.map((_, i) => pool.getPlaceholder(i + 1)).join(', ');
        await pool.query(`INSERT INTO resource_metrics (${cols.join(', ')}) VALUES (${placeholders})`, vals);
      } else {
        const eCnt = existing.sample_count; const nCnt = eCnt + agg.sampleCount;
        const updates = [
          { col: 'avg_rss_mb', val: weightedAvg(existing.avg_rss_mb, eCnt, agg.avgRssMB, agg.sampleCount) },
          { col: 'max_rss_mb', val: Math.max(existing.max_rss_mb, agg.maxRssMB) },
          { col: 'min_rss_mb', val: Math.min(existing.min_rss_mb, agg.min_rss_mb) },
          { col: 'avg_heap_mb', val: weightedAvg(existing.avg_heap_mb, eCnt, agg.avgHeapMB, agg.sampleCount) },
          { col: 'max_heap_mb', val: Math.max(existing.max_heap_mb, agg.max_heap_mb) },
          { col: 'min_heap_mb', val: Math.min(existing.min_heap_mb, agg.min_heap_mb) },
          { col: 'avg_cpu_percent', val: weightedAvg(existing.avg_cpu_percent, eCnt, agg.avgCpuPercent, agg.sampleCount) },
          { col: 'max_cpu_percent', val: Math.max(existing.max_cpu_percent, agg.max_cpu_percent) },
          { col: 'min_cpu_percent', val: Math.min(existing.min_cpu_percent, agg.min_cpu_percent) },
          { col: 'p95_rss_mb', val: agg.p95RssMB }, { col: 'p99_rss_mb', val: agg.p99RssMB },
          { col: 'p95_heap_mb', val: agg.p95HeapMB }, { col: 'p99_heap_mb', val: agg.p99HeapMB },
          { col: 'p95_cpu_percent', val: agg.p95CpuPercent }, { col: 'p99_cpu_percent', val: agg.p99CpuPercent },
          { col: 'sample_count', val: nCnt },
        ];
        const setClause = updates.map((u, i) => `${u.col} = ${pool.getPlaceholder(i + 1)}`).join(', ');
        const params = updates.map(u => u.val); params.push(agg.bucketStart);
        await pool.query(`UPDATE resource_metrics SET ${setClause} WHERE bucket_start = ${pool.getPlaceholder(params.length)}`, params);
      }
    }
  } catch (err) { console.error('[resourceMetrics] persist fail', err); throw err; }
}

async function flushBuffer(): Promise<void> {
  const rel = await bufferMutex.acquire();
  try {
    if (memoryBuffer.length === 0) return;
    const samples = [...memoryBuffer]; const aggregates = aggregateToBuckets(samples);
    if (aggregates.length === 0) { memoryBuffer.length = 0; return; }
    try {
      await persistAggregate(aggregates);
      const maxTs = Math.max(...samples.map(s => s.timestamp));
      const retained = memoryBuffer.filter(s => s.timestamp > maxTs);
      memoryBuffer.splice(0, memoryBuffer.length, ...retained);
      console.info(`[resourceMetrics] flushed ${samples.length} samples`);
    } catch (e) { console.warn('Flush fail, retaining', e); }
  } finally { rel(); }
}

async function pruneOldData(): Promise<void> {
  try {
    const cutoff = new Date(); cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
    const res = await pool.query(`DELETE FROM resource_metrics WHERE bucket_start < ${pool.getPlaceholder(1)}`, [cutoff]);
    if (res.rowCount > 0) console.info(`[resourceMetrics] pruned ${res.rowCount} records`);
  } catch (err) { console.error('[resourceMetrics] prune fail', err); }
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
    const cols = pool.type === DatabaseType.POSTGRESQL
      ? 'id BIGSERIAL PRIMARY KEY, bucket_start TIMESTAMPTZ NOT NULL UNIQUE, avg_rss_mb FLOAT NOT NULL, max_rss_mb FLOAT NOT NULL, min_rss_mb FLOAT NOT NULL, p95_rss_mb FLOAT NOT NULL, p99_rss_mb FLOAT NOT NULL, avg_heap_mb FLOAT NOT NULL, max_heap_mb FLOAT NOT NULL, min_heap_mb FLOAT NOT NULL, p95_heap_mb FLOAT NOT NULL, p99_heap_mb FLOAT NOT NULL, avg_cpu_percent FLOAT NOT NULL, max_cpu_percent FLOAT NOT NULL, min_cpu_percent FLOAT NOT NULL, p95_cpu_percent FLOAT NOT NULL, p99_cpu_percent FLOAT NOT NULL, sample_count INTEGER NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()'
      : 'id BIGINT IDENTITY(1,1) PRIMARY KEY, bucket_start DATETIME2 NOT NULL, avg_rss_mb FLOAT NOT NULL, max_rss_mb FLOAT NOT NULL, min_rss_mb FLOAT NOT NULL, p95_rss_mb FLOAT NOT NULL, p99_rss_mb FLOAT NOT NULL, avg_heap_mb FLOAT NOT NULL, max_heap_mb FLOAT NOT NULL, min_heap_mb FLOAT NOT NULL, p95_heap_mb FLOAT NOT NULL, p99_heap_mb FLOAT NOT NULL, avg_cpu_percent FLOAT NOT NULL, max_cpu_percent FLOAT NOT NULL, min_cpu_percent FLOAT NOT NULL, p95_cpu_percent FLOAT NOT NULL, p99_cpu_percent FLOAT NOT NULL, sample_count INTEGER NOT NULL, created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()';
    await pool.query(pool.getCreateTableIfNotExistsSql('resource_metrics', cols));
    await pool.query(pool.getCreateIndexIfNotExistsSql('idx_resource_metrics_bucket', 'resource_metrics', 'bucket_start', true));
    console.info('[resourceMetrics] table ready');
  } catch (err) { console.error('[resourceMetrics] init fail', err); throw err; }
  getCpuPercent();
  sampleInterval = setInterval(() => { void takeSample().catch(() => {}); }, SAMPLE_INTERVAL_MS);
  const now = Date.now(); const next = Math.ceil(now / FLUSH_INTERVAL_MS) * FLUSH_INTERVAL_MS;
  alignmentTimeout = setTimeout(() => {
    void flushBuffer().catch(() => {}); void pruneOldData().catch(() => {});
    flushInterval = setInterval(() => { void flushBuffer().catch(() => {}); void pruneOldData().catch(() => {}); }, FLUSH_INTERVAL_MS);
  }, next - now);
  console.info('[resourceMetrics] initialized');
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
    const hours = options.hours || 24; const cutoff = options.startDate || new Date(Date.now() - hours * 3600000);
    const bStart = pool.type === DatabaseType.POSTGRESQL ? '"bucketStart"' : 'bucketStart';
    const sql = `SELECT bucket_start as ${bStart}, avg_rss_mb as ${pool.type === DatabaseType.POSTGRESQL ? '"avgRssMB"' : 'avgRssMB'}, max_rss_mb as ${pool.type === DatabaseType.POSTGRESQL ? '"maxRssMB"' : 'maxRssMB'}, avg_heap_mb as ${pool.type === DatabaseType.POSTGRESQL ? '"avgHeapMB"' : 'avgHeapMB'}, max_heap_mb as ${pool.type === DatabaseType.POSTGRESQL ? '"maxHeapMB"' : 'maxHeapMB'}, avg_cpu_percent as ${pool.type === DatabaseType.POSTGRESQL ? '"avgCpuPercent"' : 'avgCpuPercent'}, max_cpu_percent as ${pool.type === DatabaseType.POSTGRESQL ? '"maxCpuPercent"' : 'maxCpuPercent'}, sample_count as ${pool.type === DatabaseType.POSTGRESQL ? '"sampleCount"' : 'sampleCount'} FROM resource_metrics WHERE bucket_start >= ${pool.getPlaceholder(1)} ${options.endDate ? `AND bucket_start <= ${pool.getPlaceholder(2)}` : ''} ORDER BY bucket_start ASC`;
    const params = [cutoff]; if (options.endDate) params.push(options.endDate);
    const res = await pool.query<any>(sql, params); const dbRows = res.rows;
    const rel = await bufferMutex.acquire(); let bAggs; try { bAggs = aggregateToBuckets(memoryBuffer); } finally { rel(); }
    const merged = new Map<number, any>(); for (const r of dbRows) merged.set(new Date(r.bucketStart).getTime(), r);
    for (const agg of bAggs) {
      const ts = agg.bucketStart.getTime(); const ex = merged.get(ts);
      if (ex) {
        const tot = ex.sampleCount + agg.sampleCount;
        merged.set(ts, { bucketStart: agg.bucketStart, avgRssMB: weightedAvg(ex.avgRssMB, ex.sampleCount, agg.avgRssMB, agg.sampleCount), maxRssMB: Math.max(ex.maxRssMB, agg.maxRssMB), avgHeapMB: weightedAvg(ex.avgHeapMB, ex.sampleCount, agg.avgHeapMB, agg.sampleCount), maxHeapMB: Math.max(ex.maxHeapMB, agg.maxHeapMB), avgCpuPercent: weightedAvg(ex.avgCpuPercent, ex.sampleCount, agg.avgCpuPercent, agg.sampleCount), maxCpuPercent: Math.max(ex.maxCpuPercent, agg.maxCpuPercent), sampleCount: tot });
      } else {
        merged.set(ts, { bucketStart: agg.bucketStart, avgRssMB: agg.avgRssMB, maxRssMB: agg.maxRssMB, avgHeapMB: agg.avgHeapMB, maxHeapMB: agg.maxHeapMB, avgCpuPercent: agg.avgCpuPercent, maxCpuPercent: agg.maxCpuPercent, sampleCount: agg.sampleCount });
      }
    }
    return Array.from(merged.values()).filter(r => r.bucketStart >= cutoff && (!options.endDate || r.bucketStart <= options.endDate)).sort((a,b) => a.bucketStart.getTime() - b.bucketStart.getTime());
  } catch (err) { console.error('[resourceMetrics] getHistory fail', err); return []; }
}

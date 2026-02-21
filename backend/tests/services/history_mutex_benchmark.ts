
import { Mutex } from 'async-mutex';

// Current implementation simulation
const bufferMutex = new Mutex();
const historyBuffer: any[] = [];
const MAX_HISTORY_BUFFER = 50_000;

async function recordPlayerQueryWithMutex(record: any): Promise<void> {
  await bufferMutex.runExclusive(() => {
    if (historyBuffer.length >= MAX_HISTORY_BUFFER) {
      historyBuffer.shift();
    }
    historyBuffer.push(record);
  });
}

// Optimized implementation simulation
const historyBufferOptimized: any[] = [];

function recordPlayerQueryOptimized(record: any): void {
  if (historyBufferOptimized.length >= MAX_HISTORY_BUFFER) {
    historyBufferOptimized.shift();
  }
  historyBufferOptimized.push(record);
}

async function benchmark() {
  const iterations = 1_000_000;
  const record = { id: 1 };

  console.log(`Benchmarking ${iterations} iterations...`);

  // Measure Mutex
  const startMutex = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    await recordPlayerQueryWithMutex(record);
  }
  const endMutex = process.hrtime.bigint();
  const durationMutex = Number(endMutex - startMutex) / 1_000_000; // ms

  console.log(`With Mutex: ${durationMutex.toFixed(2)} ms`);

  // Measure Optimized
  const startOpt = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    recordPlayerQueryOptimized(record);
  }
  const endOpt = process.hrtime.bigint();
  const durationOpt = Number(endOpt - startOpt) / 1_000_000; // ms

  console.log(`Without Mutex: ${durationOpt.toFixed(2)} ms`);
  console.log(`Improvement: ${(durationMutex / durationOpt).toFixed(1)}x faster`);
}

benchmark().catch(console.error);

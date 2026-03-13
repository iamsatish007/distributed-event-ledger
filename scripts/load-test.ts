import { randomUUID } from 'crypto';

const COMMAND_API_URL = process.env.COMMAND_API_URL || 'http://localhost:3001/api/v1/transactions';
const QUERY_API_URL = process.env.QUERY_API_URL || 'http://localhost:3002/api/v1/accounts';

const TOTAL_TRANSACTIONS = 1_000_000;
const CONCURRENCY_LIMIT = 500; // how many transactions in flight at once
const READ_CONCURRENCY_LIMIT = 50;

// Test account pool
const ACCOUNT_COUNT = 1000;
const accounts: string[] = Array.from({ length: ACCOUNT_COUNT }, () => `acc-${randomUUID().slice(0, 8)}`);

// Metrics
const metrics = {
  transactionsSent: 0,
  transactionsFailed: 0,
  writeStartTime: 0,
  writeEndTime: 0,
  
  readsCount: 0,
  readsFailed: 0,
  readLatenciesMs: [] as number[]
};

/**
 * Async queue to limit concurrency
 */
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let active = 0;
  let index = 0;
  
  return new Promise<void>((resolve, reject) => {
    let hasError = false;

    const next = () => {
      if (hasError) return;
      if (index >= items.length && active === 0) {
        resolve();
        return;
      }

      while (active < limit && index < items.length) {
        active++;
        const currentItem = items[index++];
        worker(currentItem)
          .then(() => {
            active--;
            next();
          })
          .catch((err) => {
            hasError = true;
            reject(err);
          });
      }
    };
    next();
  });
}

/**
 * Executes a single Write Transaction
 */
async function performWriteTransaction() {
  const accountId = accounts[Math.floor(Math.random() * accounts.length)];
  const amount = Math.floor(Math.random() * 1000) + 1;
  const type = Math.random() > 0.5 ? 'CREDIT' : 'DEBIT';
  const idempotencyKey = randomUUID();

  try {
    const res = await fetch(COMMAND_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, amount, type, idempotencyKey }),
    });

    if (res.ok) {
      metrics.transactionsSent++;
    } else {
      metrics.transactionsFailed++;
    }
  } catch (error) {
    metrics.transactionsFailed++;
  }

  // Print progress
  if ((metrics.transactionsSent + metrics.transactionsFailed) % 10000 === 0) {
    console.log(`[Write] Sent ${metrics.transactionsSent + metrics.transactionsFailed}/${TOTAL_TRANSACTIONS} transactions...`);
  }
}

/**
 * Continuously performs Read queries while the load test is running
 */
async function runReadLoad() {
  const readWorkerPool = Array.from({ length: READ_CONCURRENCY_LIMIT });
  let running = true;

  const readTask = async () => {
    while (running) {
      const accountId = accounts[Math.floor(Math.random() * accounts.length)];
      
      const start = performance.now();
      try {
        const res = await fetch(`${QUERY_API_URL}/${accountId}/balance`);
        const end = performance.now();
        
        if (res.ok) {
          metrics.readLatenciesMs.push(end - start);
          metrics.readsCount++;
        } else if (res.status === 404) {
          // It's normal for 404 if account hasn't been created in projector yet
          metrics.readsCount++; 
          metrics.readLatenciesMs.push(end - start);
        } else {
          metrics.readsFailed++;
        }
      } catch (e) {
        metrics.readsFailed++;
      }

      // Small sleep to avoid completely overwhelming single thread event loop
      await new Promise(r => setTimeout(r, 5));
    }
  };

  const tasks = readWorkerPool.map(() => readTask());
  
  return {
    stop: () => { running = false; },
    wait: () => Promise.all(tasks)
  };
}

async function startLoadTest() {
  console.log('=============================================');
  console.log(`Starting Load Test: 1M Transactions Simulator`);
  console.log(`Target Command API: ${COMMAND_API_URL}`);
  console.log(`Target Query API:   ${QUERY_API_URL}`);
  console.log(`Concurrency Limit:  ${CONCURRENCY_LIMIT}`);
  console.log('=============================================\n');

  metrics.writeStartTime = performance.now();

  // Start background reads
  console.log('[Info] Starting background read queries to measure latency...');
  const readEngine = await runReadLoad();

  // Create write array
  const writeTasks = Array.from({ length: TOTAL_TRANSACTIONS }, (_, i) => i);

  console.log(`[Info] Starting ${TOTAL_TRANSACTIONS} write transactions...`);
  
  await runWithConcurrency(writeTasks, CONCURRENCY_LIMIT, async () => {
    await performWriteTransaction();
  });

  metrics.writeEndTime = performance.now();
  console.log(`[Info] Completed all write requests. Stopping reads...`);
  
  // Stop reads
  readEngine.stop();
  await readEngine.wait();

  printReport();
}

function calculatePercentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const index = Math.floor(sorted.length * p);
  return sorted[index];
}

function printReport() {
  const { 
    transactionsSent, transactionsFailed, 
    writeStartTime, writeEndTime, 
    readsCount, readsFailed, readLatenciesMs 
  } = metrics;
  
  const writeDurationSec = (writeEndTime - writeStartTime) / 1000;
  const tps = (transactionsSent + transactionsFailed) / writeDurationSec;

  readLatenciesMs.sort((a, b) => a - b);
  const avgRead = readLatenciesMs.length > 0 
    ? readLatenciesMs.reduce((sum, val) => sum + val, 0) / readLatenciesMs.length 
    : 0;
  const p50Read = calculatePercentile(readLatenciesMs, 0.50);
  const p90Read = calculatePercentile(readLatenciesMs, 0.90);
  const p95Read = calculatePercentile(readLatenciesMs, 0.95);
  const p99Read = calculatePercentile(readLatenciesMs, 0.99);

  console.log('\n=============================================');
  console.log('              LOAD TEST SUMMARY              ');
  console.log('=============================================');
  console.log(`Total Write Transactions:  ${TOTAL_TRANSACTIONS}`);
  console.log(`Successful Writes:         ${transactionsSent}`);
  console.log(`Failed Writes:             ${transactionsFailed}`);
  console.log(`Total Time Taken:          ${writeDurationSec.toFixed(2)} seconds`);
  console.log(`Write Throughput (TPS):    ${tps.toFixed(2)} req/sec`);
  console.log('---------------------------------------------');
  console.log(`Total Read Queries:        ${readsCount}`);
  console.log(`Failed Reads:              ${readsFailed}`);
  console.log('--- Read Latency Metrics (ms) ---');
  console.log(`  Average: ${avgRead.toFixed(2)} ms`);
  console.log(`  p50:     ${p50Read.toFixed(2)} ms`);
  console.log(`  p90:     ${p90Read.toFixed(2)} ms`);
  console.log(`  p95:     ${p95Read.toFixed(2)} ms`);
  console.log(`  p99:     ${p99Read.toFixed(2)} ms`);
  
  console.log('\n=============================================');
  if (p95Read < 50) {
    console.log(`✅ Passed: Sub-50ms Read Latency (p95 = ${p95Read.toFixed(2)}ms)`);
  } else {
    console.log(`❌ Failed: Sub-50ms Read Latency not met (p95 = ${p95Read.toFixed(2)}ms)`);
  }
  console.log('=============================================');
}

startLoadTest().catch(console.error);

/**
 * SSE Soak Test Tool
 *
 * Guarded by SOAK=1.
 * Usage: SOAK=1 BASE=http://localhost:3000 JOB=<jobId> MINUTES=10 npx tsx scratch/sseSoak.ts
 */

if (process.env.SOAK !== '1') {
  console.log('[sseSoak] Skipped: SOAK=1 guard not set.');
  process.exit(0);
}

import http from 'node:http';
import https from 'node:https';
import { prisma } from '../src/db/client.ts';
import { openJobChannel } from '../src/agent/jobEvents.ts';

import { config } from '../src/config.ts';

const base = process.env.BASE || 'http://localhost:3000';
const minutes = parseFloat(process.env.MINUTES || '10');
const totalDurationMs = Math.round(minutes * 60 * 1000);

async function resolveJobId(): Promise<string> {
  if (process.env.JOB) {
    return process.env.JOB;
  }

  console.log('[sseSoak] No JOB specified. Provisioning a multi-job run group via POST /api/generate...');
  const res = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.GROQ_API_KEY ? { 'x-groq-api-key': config.GROQ_API_KEY } : {}),
    },
    body: JSON.stringify({
      urls: [
        'https://demo.playwright.dev/todomvc',
        'https://example.com',
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create soak job: HTTP ${res.status} ${text}`);
  }

  const data = (await res.json()) as { jobIds: string[] };
  console.log('[sseSoak] Created run group with job IDs:', data.jobIds);
  // Target the second job which will hold stream while queued and running
  return data.jobIds.length > 1 ? data.jobIds[1] : data.jobIds[0];
}

async function runSoak(): Promise<void> {
  const jobId = await resolveJobId();
  const streamUrl = new URL(`/api/jobs/${jobId}/stream`, base);

  console.log(`[sseSoak] Starting SSE soak test:`);
  console.log(`  Target:   ${streamUrl.href}`);
  console.log(`  Job ID:   ${jobId}`);
  console.log(`  Duration: ${minutes} minute(s) (${totalDurationMs} ms)`);
  console.log(`  Started:  ${new Date().toISOString()}`);

  const startTime = Date.now();
  const endTime = startTime + totalDurationMs;

  let disconnectCount = 0;
  let eventCount = 0;
  let heartbeatCount = 0;
  let lastHeartbeatTime = Date.now();
  let maxGapBetweenHeartbeats = 0;
  let lastEventId: string | null = null;
  let shouldStop = false;

  const timer = setTimeout(() => {
    shouldStop = true;
  }, totalDurationMs);
  timer.unref();

  while (Date.now() < endTime && !shouldStop) {
    await new Promise<void>((resolve) => {
      const isHttps = streamUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
      };
      if (lastEventId) {
        headers['Last-Event-ID'] = lastEventId;
      }

      const req = client.get(
        streamUrl.href,
        {
          headers,
          timeout: 30_000,
        },
        (res) => {
          if (res.statusCode !== 200) {
            console.warn(`[${new Date().toISOString()}] Unexpected status code: ${res.statusCode}`);
            res.resume();
            resolve();
            return;
          }

          console.log(`[${new Date().toISOString()}] SSE stream connected (HTTP 200)`);

          let buffer = '';
          res.setEncoding('utf8');

          res.on('data', (chunk: string) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              const now = Date.now();
              if (trimmed === ': ping') {
                heartbeatCount += 1;
                const gap = now - lastHeartbeatTime;
                if (gap > maxGapBetweenHeartbeats) {
                  maxGapBetweenHeartbeats = gap;
                }
                lastHeartbeatTime = now;
                console.log(`[${new Date().toISOString()}] Received heartbeat (: ping) [gap: ${gap}ms]`);
              } else if (trimmed.startsWith('id:')) {
                lastEventId = trimmed.slice(3).trim();
              } else if (trimmed.startsWith('event:')) {
                eventCount += 1;
                console.log(`[${new Date().toISOString()}] Received event: ${trimmed.slice(6).trim()}`);
              }
            }
          });

          res.on('end', () => {
            console.log(`[${new Date().toISOString()}] SSE response ended.`);
            resolve();
          });

          res.on('error', (err) => {
            console.warn(`[${new Date().toISOString()}] Stream response error:`, err.message);
            resolve();
          });
        },
      );

      req.on('error', (err) => {
        console.warn(`[${new Date().toISOString()}] Request error:`, err.message);
        resolve();
      });

      const checkInterval = setInterval(() => {
        if (shouldStop || Date.now() >= endTime) {
          clearInterval(checkInterval);
          req.destroy();
          resolve();
        }
      }, 500);
      checkInterval.unref();
    });

    if (Date.now() < endTime && !shouldStop) {
      disconnectCount += 1;
      console.log(`[${new Date().toISOString()}] Stream disconnected (total disconnects: ${disconnectCount}). Reconnecting in 1s...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n================ SSE SOAK TEST REPORT ================');
  console.log(`Elapsed Time:               ${elapsedSec}s / ${minutes * 60}s`);
  console.log(`Total Events Received:      ${eventCount}`);
  console.log(`Total Heartbeats Received:  ${heartbeatCount}`);
  console.log(`Disconnect Count:           ${disconnectCount}`);
  console.log(`Max Gap Between Heartbeats: ${maxGapBetweenHeartbeats}ms (${(maxGapBetweenHeartbeats / 1000).toFixed(2)}s)`);
  console.log('======================================================\n');
}

runSoak()
  .catch((err) => {
    console.error('[sseSoak] Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

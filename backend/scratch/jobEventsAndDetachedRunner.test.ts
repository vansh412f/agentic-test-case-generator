import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { openJobChannel, publishJobEvent, subscribeJobEvents, type JobEvent } from '../src/agent/jobEvents.ts';
import { startDetachedRun, inFlightJobs } from '../src/agent/jobRunner.ts';
import { pipelineGate } from '../src/security/concurrencyGate.ts';
import { llmKeyOverride } from '../src/llm/requestKeys.ts';
import { GenerateRequestSchema } from '../src/api/schemas.ts';
import { MAX_URLS_PER_RUN } from '../src/agent/run.config.ts';

// --- Event channel replay semantics -----------------------------------------
const jobA = '00000000-0000-4000-8000-00000000000a';
assert.equal(subscribeJobEvents(jobA, undefined, () => {}), null, 'no channel -> null (DB snapshot only)');
openJobChannel(jobA);
publishJobEvent(jobA, { type: 'phase_change', data: { status: 'crawling' } });
publishJobEvent(jobA, { type: 'phase_change', data: { status: 'planning' } });

const live: JobEvent[] = [];
const fresh = subscribeJobEvents(jobA, undefined, (e) => live.push(e));
assert.ok(fresh);
assert.equal(fresh.replay.length, 2, 'no Last-Event-ID -> full replay');
const lastId = fresh.replay[0]?.id;
const resumed = subscribeJobEvents(jobA, lastId, () => {});
assert.equal(resumed?.replay.length, 1, 'same-boot Last-Event-ID -> filtered replay');
const foreign = subscribeJobEvents(jobA, 'deadbeef.99', () => {});
assert.equal(foreign?.replay.length, 2, 'foreign-boot Last-Event-ID -> full replay');
resumed?.unsubscribe();
foreign?.unsubscribe();

publishJobEvent(jobA, { type: 'job_finished', data: { status: 'completed', errorCode: null } });
publishJobEvent(jobA, { type: 'phase_change', data: { status: 'crawling' } });
assert.deepEqual(live.map((e) => e.type), ['job_finished'], 'live delivery; nothing after job_finished');
fresh.unsubscribe();
console.log('[PASS] Channel replay + finish semantics');

// --- Detached run keeps BYOK ALS context, releases gate exactly once --------
assert.equal(pipelineGate.tryAcquire(), true);
const before = pipelineGate.activeCount;
const seenKeys: Array<string | undefined> = [];
const order: string[] = [];
let settled = false;
startDetachedRun(
  [{ id: 'job-1', url: 'https://a.example' }, { id: 'job-2', url: 'https://b.example' }],
  { groq: 'gsk_test_key' },
  {
    onSettled: () => {
      settled = true;
      pipelineGate.release();
    },
    runOne: async (job) => {
      await sleep(10); // cross an async boundary like a real pipeline
      seenKeys.push(llmKeyOverride('groq'));
      order.push(job.id);
      if (job.id === 'job-1') throw new Error('simulated pipeline failure');
    },
  },
);
assert.deepEqual(inFlightJobs().sort(), ['job-1', 'job-2']);
assert.equal(llmKeyOverride('groq'), undefined, 'keys must not leak into the caller scope');
await sleep(60);
assert.deepEqual(order, ['job-1', 'job-2'], 'sequential; one failure does not stop the group');
assert.deepEqual(seenKeys, ['gsk_test_key', 'gsk_test_key'], 'ALS context survives the detached chain');
assert.equal(settled, true, 'onSettled invoked');
assert.equal(pipelineGate.activeCount, before - 1, 'gate released exactly once per group');
assert.deepEqual(inFlightJobs(), []);
// --- Detached run request schema ---------------------------------------------
assert.equal(GenerateRequestSchema.safeParse({ url: 'https://x.example' }).success, true);
assert.equal(GenerateRequestSchema.safeParse({ urls: ['https://x.example'] }).success, true);
assert.equal(GenerateRequestSchema.safeParse({ url: 'https://x.example', urls: ['https://y.example'] }).success, false);
assert.equal(
  GenerateRequestSchema.safeParse({ urls: Array.from({ length: MAX_URLS_PER_RUN + 1 }, (_, i) => `https://x${i}.example`) }).success,
  false,
);
console.log('[PASS] Detached run request schema');
console.log('SSE Job Events & Detached Runner verification passed.');

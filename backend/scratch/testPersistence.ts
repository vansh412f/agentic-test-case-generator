import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const BASE = 'http://localhost:4000';
const target = process.argv[2] ?? 'https://demo.playwright.dev/todomvc/';
const GeneratedResponse = z.object({ jobId: z.string().uuid() });
const JobResponse = z.object({
  id: z.string().uuid(),
  status: z.string(),
  agentSteps: z.array(z.object({ id: z.string() })).min(1),
  generatedTests: z.array(z.object({
    id: z.string(), totalAttempts: z.number(),
    executionResults: z.array(z.object({ code: z.string(), attemptNumber: z.number() })).min(1),
  })).min(1),
});

async function checked(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${BASE}${url}`, init);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response;
}

async function main(): Promise<void> {
  const response = await checked('/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target }),
  });
  const generated: unknown = await response.json();
  const { jobId } = GeneratedResponse.parse(generated);
  console.log(`[PASS] generate: ${jobId}`);

  const detail: unknown = await (await checked(`/api/jobs/${jobId}`)).json();
  console.log(JSON.stringify(detail, null, 2));
  const job = JobResponse.parse(detail);
  if (job.id !== jobId || job.status !== 'completed') throw new Error('Incorrect persisted job identity/status');
  if (job.generatedTests.some((test) => test.totalAttempts !== test.executionResults.length)) {
    throw new Error('Attempt count mismatch');
  }
  console.log('[PASS] detail: Job, AgentStep, GeneratedTest, ExecutionResult populated');

  let found = false;
  let page = 1;
  let pages = 1;
  do {
    const body: unknown = await (await checked(`/api/jobs?page=${page}&limit=100`)).json();
    const list = z.object({ jobs: z.array(z.object({ id: z.string() })), totalPages: z.number() }).parse(body);
    found = list.jobs.some((entry) => entry.id === jobId);
    pages = list.totalPages;
    page++;
  } while (!found && page <= pages);
  if (!found) throw new Error('Job missing from paginated list');
  console.log('[PASS] list');

  const directory = await mkdtemp(path.join(tmpdir(), 'test-persistence-'));
  const report = path.join(directory, `report-${jobId}.html`);
  await writeFile(report, await (await checked(`/api/jobs/${jobId}/report.html`)).text(), 'utf8');
  console.log(`[PASS] report saved: ${report}`);

  const zip = path.join(directory, `tests-${jobId}.zip`);
  await writeFile(zip, Buffer.from(await (await checked(`/api/jobs/${jobId}/export.zip`)).arrayBuffer()));
  console.log(`[PASS] ZIP saved: ${zip}`);
  console.log('Verification passed. Open the report offline and extract/run the ZIP manually.');
}

main().catch((error: unknown) => {
  console.error('[FAIL]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

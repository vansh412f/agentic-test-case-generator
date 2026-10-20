import type { AppMap, Observation } from '../src/crawler/types.ts';
import type { TestDataEntry } from '../src/api/schemas.ts';

const API_BASE = 'http://127.0.0.1:4000/api';

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface StepDetail {
  id: string;
  stepType: string;
  status: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  llmModel?: string;
  llmProvider?: string;
}

interface GeneratedTestDetail {
  id: string;
  testCaseId: string;
  filename: string;
  finalStatus: string;
  finalCode: string;
  attempts: Array<{
    attemptNumber: number;
    status: string;
    errorText?: string;
    summary?: {
      headline?: string;
      line?: number;
      kind?: string;
    };
  }>;
}

interface JobPayload {
  id: string;
  targetUrl: string;
  status: string;
  appMap?: AppMap & { observations?: Observation[] };
  steps: StepDetail[];
  generatedTests: GeneratedTestDetail[];
  testPlan?: {
    testCases: Array<{
      id: string;
      title: string;
      description?: string;
      steps: Array<{
        action: string;
        target?: string | null;
        value?: string | null;
        description?: string;
      }>;
    }>;
  };
}

async function crawl(url: string): Promise<AppMap> {
  console.log(`[CRAWL] Crawling ${url}...`);
  const res = await fetch(`${API_BASE}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Crawl failed: ${res.status} ${text}`);
  }
  const data = await res.json() as AppMap;
  return data;
}

async function startJob(url: string, testData?: TestDataEntry[]): Promise<string> {
  console.log(`[GENERATE] Starting job for ${url} (testData entries: ${testData?.length ?? 0})...`);
  const res = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      testData,
      fresh: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Generate failed: ${res.status} ${text}`);
  }
  const data = await res.json() as { jobIds: string[] };
  return data.jobIds[0];
}

async function pollJob(jobId: string, maxWaitMs = 180_000): Promise<JobPayload> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${API_BASE}/jobs/${jobId}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Fetch job ${jobId} failed: ${res.status} ${text}`);
    }
    const job = await res.json() as JobPayload;
    process.stdout.write(`\r[POLL] Job ${jobId} status: ${job.status} (${Math.round((Date.now() - start) / 1000)}s)...`);
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      console.log(`\n[POLL] Finished with status: ${job.status}`);
      return job;
    }
    await delay(3000);
  }
  throw new Error(`Job ${jobId} timed out after ${maxWaitMs / 1000}s`);
}

async function analyzeJob(job: JobPayload, label: string) {
  console.log(`\n========================================================`);
  console.log(`JOB REPORT: ${label} (${job.id})`);
  console.log(`URL: ${job.targetUrl}`);
  console.log(`Status: ${job.status}`);
  console.log(`========================================================`);

  const steps = ((job as any).agentSteps ?? job.steps ?? []) as StepDetail[];

  // 1. Observe Step
  const observeStep = steps.find((s) => s.stepType === 'observe');
  if (observeStep) {
    const sec = ((observeStep.latencyMs ?? 0) / 1000).toFixed(1);
    console.log(`Observe Step: ${sec}s, promptTokens=${observeStep.promptTokens ?? 0}, completionTokens=${observeStep.completionTokens ?? 0}`);
  } else {
    console.log(`Observe Step: NOT FOUND in timeline`);
  }

  // 2. Plan Step
  const planSteps = steps.filter((s) => s.stepType === 'plan');
  const planPromptTokens = planSteps.reduce((acc, s) => acc + (s.promptTokens ?? 0), 0);
  const planCompletionTokens = planSteps.reduce((acc, s) => acc + (s.completionTokens ?? 0), 0);
  const planTotalTokens = planPromptTokens + planCompletionTokens;
  console.log(`Plan Step(s): ${planSteps.length} step(s), promptTokens=${planPromptTokens}, completionTokens=${planCompletionTokens}, total=${planTotalTokens}`);

  // 3. Observations in AppMap (fetch from /api/jobs/:id/appmap)
  let obs: Observation[] = job.appMap?.observations ?? [];
  try {
    const mapRes = await fetch(`${API_BASE}/jobs/${job.id}/appmap`);
    if (mapRes.ok) {
      const mapJson = await mapRes.json() as { appMap?: { observations?: Observation[] } };
      if (mapJson.appMap?.observations) {
        obs = mapJson.appMap.observations;
      }
    }
  } catch {
    // Ignore
  }
  console.log(`Stored Observations: ${obs.length}`);
  for (const o of obs) {
    console.log(`  - [${o.kind}] ${o.finalUrl ?? o.containerCss ?? ''} (${o.visibleTexts?.length ?? 0} texts)`);
  }

  // 4. Test Results
  const total = job.generatedTests.length;
  const passed = job.generatedTests.filter((t) => t.finalStatus === 'passed').length;
  const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';
  console.log(`\nTests: ${passed}/${total} passed (${rate}%)`);

  for (const t of job.generatedTests) {
    const mark = t.finalStatus === 'passed' ? '✓ PASS' : '✗ FAIL';
    const attempts = ((t as any).executionResults ?? t.attempts ?? []) as any[];
    console.log(`  ${mark} [${t.testCaseId}] ${t.filename} (attempts: ${attempts.length})`);
    if (t.finalStatus !== 'passed') {
      const lastAttempt = attempts[attempts.length - 1];
      const err = lastAttempt?.summary?.headline ?? lastAttempt?.executionError ?? lastAttempt?.errorText ?? 'unknown error';
      console.log(`         Error: ${String(err).split('\n')[0]}`);
    }
  }

  return {
    jobId: job.id,
    url: job.targetUrl,
    total,
    passed,
    rate: `${rate}%`,
    observeSec: observeStep ? ((observeStep.latencyMs ?? 0) / 1000).toFixed(1) : 'N/A',
    planTokens: planTotalTokens,
    observationsCount: obs.length,
    tests: job.generatedTests,
    testPlan: job.testPlan,
  };
}

async function main() {
  const targetSite = process.argv[2] ?? 'all';
  console.log(`Starting Showcase Runs (target: ${targetSite})...\n`);

  const results: Record<string, ReturnType<typeof analyzeJob>> = {};

  // ---------------------------------------------------------------------------
  // (b) the-internet.herokuapp.com/login WITH test data
  // ---------------------------------------------------------------------------
  if (targetSite === 'all' || targetSite === 'the-internet') {
    console.log('\n>>> SHOWCASE (b): the-internet login with credentials <<<');
    const map = await crawl('https://the-internet.herokuapp.com/login');
    const userEl = map.elements.find((e) => /username/i.test(e.name ?? '') || /username/i.test(e.selectors.css));
    const passEl = map.elements.find((e) => /password/i.test(e.name ?? '') || /password/i.test(e.selectors.css));

    const testData: TestDataEntry[] = [];
    if (userEl) testData.push({ elementId: userEl.id, css: userEl.selectors.css, value: 'tomsmith', sensitive: false });
    if (passEl) testData.push({ elementId: passEl.id, css: passEl.selectors.css, value: 'SuperSecretPassword!', sensitive: true });

    const jobId = await startJob('https://the-internet.herokuapp.com/login', testData);
    const job = await pollJob(jobId);
    results['the-internet'] = await analyzeJob(job, 'the-internet.herokuapp.com/login (WITH credentials)');
  }

  // ---------------------------------------------------------------------------
  // (a) saucedemo.com WITH test data
  // ---------------------------------------------------------------------------
  if (targetSite === 'all' || targetSite === 'saucedemo') {
    console.log('\n>>> SHOWCASE (a): saucedemo with credentials <<<');
    const map = await crawl('https://www.saucedemo.com/');
    const userEl = map.elements.find((e) => /user/i.test(e.name ?? '') || /user/i.test(e.selectors.css));
    const passEl = map.elements.find((e) => /password/i.test(e.name ?? '') || /password/i.test(e.selectors.css));

    const testData: TestDataEntry[] = [];
    if (userEl) testData.push({ elementId: userEl.id, css: userEl.selectors.css, value: 'standard_user', sensitive: false });
    if (passEl) testData.push({ elementId: passEl.id, css: passEl.selectors.css, value: 'secret_sauce', sensitive: true });

    const jobId = await startJob('https://www.saucedemo.com/', testData);
    const job = await pollJob(jobId);
    results['saucedemo'] = await analyzeJob(job, 'saucedemo.com (WITH credentials)');
  }

  // ---------------------------------------------------------------------------
  // (c) demo.playwright.dev/todomvc without test data
  // ---------------------------------------------------------------------------
  if (targetSite === 'all' || targetSite === 'todomvc') {
    console.log('\n>>> SHOWCASE (c): todomvc without test data <<<');
    const jobId = await startJob('https://demo.playwright.dev/todomvc');
    const job = await pollJob(jobId);
    results['todomvc'] = await analyzeJob(job, 'demo.playwright.dev/todomvc');
  }

  // ---------------------------------------------------------------------------
  // (d) practicetestautomation.com/practice-test-login/ WITH test data
  // ---------------------------------------------------------------------------
  if (targetSite === 'all' || targetSite === 'practice') {
    console.log('\n>>> SHOWCASE (d): practicetestautomation login with credentials <<<');
    const map = await crawl('https://practicetestautomation.com/practice-test-login/');
    const userEl = map.elements.find((e) => /username/i.test(e.name ?? '') || /username/i.test(e.selectors.css));
    const passEl = map.elements.find((e) => /password/i.test(e.name ?? '') || /password/i.test(e.selectors.css));

    const testData: TestDataEntry[] = [];
    if (userEl) testData.push({ elementId: userEl.id, css: userEl.selectors.css, value: 'student', sensitive: false });
    if (passEl) testData.push({ elementId: passEl.id, css: passEl.selectors.css, value: 'Password123', sensitive: true });

    const jobId = await startJob('https://practicetestautomation.com/practice-test-login/', testData);
    const job = await pollJob(jobId);
    results['practice'] = await analyzeJob(job, 'practicetestautomation.com/practice-test-login/');
  }

  // ---------------------------------------------------------------------------
  // (e) CONTROL: saucedemo.com with NO test data
  // ---------------------------------------------------------------------------
  if (targetSite === 'all' || targetSite === 'control') {
    console.log('\n>>> SHOWCASE (e) CONTROL: saucedemo with NO test data <<<');
    const jobId = await startJob('https://www.saucedemo.com/');
    const job = await pollJob(jobId);
    const report = await analyzeJob(job, 'saucedemo.com CONTROL (NO test data)');
    results['control'] = report;

    console.log('\n--- CONTROL VALIDATION ---');
    const titles = job.testPlan?.testCases.map((c) => c.title) ?? [];
    console.log('Planned Case Titles:\n' + titles.map((t) => `  * "${t}"`).join('\n'));

    // Check that NO planned test case asserts /inventory.html or inventory page
    let postLoginAssertFound = false;
    for (const tc of job.testPlan?.testCases ?? []) {
      for (const step of tc.steps) {
        if (step.action === 'assert_url' && step.value?.includes('/inventory')) {
          postLoginAssertFound = true;
          console.error(`[FAIL] Found post-login assertion in ${tc.id}: assert_url ${step.value}`);
        }
      }
    }
    if (!postLoginAssertFound) {
      console.log('✓ CONTROL PASS: Zero test cases assert post-login /inventory.html URL!');
    }
  }

  console.log('\n=== ALL SHOWCASE RUNS COMPLETE ===');
}

main().catch((err) => {
  console.error('Fatal showcase error:', err);
  process.exit(1);
});

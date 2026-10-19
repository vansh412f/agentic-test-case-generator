import type { LoadedJob } from '../db/jobs.ts';
import { AppMapSchema } from '../crawler/types.ts';
import { TestPlanSchema } from '../agent/prompts/plannerPrompt.ts';
import { generateDiffHtml } from './diffGenerator.ts';
import { escapeHtml as h } from './escape.ts';
import { prismCss, prismJs } from './prismAssets.ts';
import { summarizeTokenUsage } from '../agent/tokenUsage.ts';
import { scoreTestConfidence } from '../agent/confidence.ts';
import { sanitizeError } from '../runner/sanitizeError.ts';
import { summarizeFailure } from './failureSummary.ts';

function confidenceBadge(score: number, band: string): string {
  const color = band === 'high' ? '#65dc99' : band === 'medium' ? '#f4cd78' : '#ff8e98';
  return `<strong style="color:${color}">${score}/100 (${h(band)})</strong>`;
}

function badge(status: string): string {
  const color =
    status === 'passed' || status === 'success' || status === 'completed'
      ? '#65dc99'
      : status === 'failed' || status === 'failure'
      ? '#ff8e98'
      : status === 'cancelled' || status === 'needs_review'
      ? '#94a3b8'
      : '#f4cd78';
  return `<strong style="color:${color}">${h(status)}</strong>`;
}

export function generateHtmlReport(job: LoadedJob): string {
  const map = AppMapSchema.safeParse(job.appMap);
  const plan = TestPlanSchema.safeParse(job.testPlan);
  const cases = plan.success ? plan.data.testCases : [];
  const llmSteps = job.agentSteps.filter((step) => step.llmProvider !== null);
  const usageRows = ['plan', 'generate', 'correct'].map((type) => {
    const steps = llmSteps.filter((step) => step.stepType === type);
    return `<tr><td>${type}</td><td>${steps.length}</td><td>${steps.reduce((n, s) => n + (s.promptTokens ?? 0), 0)}</td><td>${steps.reduce((n, s) => n + (s.completionTokens ?? 0), 0)}</td></tr>`;
  }).join('');
  const totalPrompt = llmSteps.reduce((n, step) => n + (step.promptTokens ?? 0), 0);
  const totalCompletion = llmSteps.reduce((n, step) => n + (step.completionTokens ?? 0), 0);
  const tokenUsage = summarizeTokenUsage(job.agentSteps);
  const tokenRows = tokenUsage.rows.map((row) => `<tr><td>${h(row.provider)}</td><td>${h(row.model)}</td><td>${row.calls}</td><td>${row.promptTokens}</td><td>${row.completionTokens}</td></tr>`).join('');
  const duration = job.startedAt && job.completedAt ? `${job.completedAt.getTime() - job.startedAt.getTime()} ms` : '—';
  const code = (value: string) => `<pre><code class="language-typescript">${h(value)}</code></pre>`;
  const tests = job.generatedTests.map((test) => {
    const attempts = [...test.executionResults].sort((a, b) => a.attemptNumber - b.attemptNumber);
    const history = attempts.map((attempt, index) => {
      const previous = attempts[index - 1];
      const execution = attempt.executionPassed === null ? 'not executed' : attempt.executionPassed ? 'passed' : 'failed';
      const cleanError = attempt.executionError ? sanitizeError(attempt.executionError) : attempt.executionError;
      const failureSummary = cleanError ? summarizeFailure(cleanError) : undefined;
      return `<details><summary>Attempt ${attempt.attemptNumber}${attempt.corrected ? ' (corrected)' : ''}</summary>
        <p>Validation: ${badge(attempt.validationPassed ? 'passed' : 'failed')} · Execution: ${badge(execution)}</p>
        <p>Classification: ${h(attempt.failureClass ?? '—')} · Correction applied: ${attempt.corrected ? 'yes' : 'no'} · Browser duration: ${h(attempt.durationMs ?? '—')} ms</p>
        ${failureSummary ? `<p><strong>${h(failureSummary.headline)}</strong></p>` : ''}
        ${attempt.validationErrors ? `<pre>${h(JSON.stringify(attempt.validationErrors, null, 2))}</pre>` : ''}
        ${cleanError ? `<pre>${h(cleanError)}</pre>` : ''}
        ${previous ? generateDiffHtml(previous.code, attempt.code, attempt.attemptNumber) : ''}
        ${code(attempt.code)}</details>`;
    }).join('');
    const title = cases.find((testCase) => testCase.id === test.testCaseId)?.title ?? test.filename;
    const confidence = scoreTestConfidence({ code: test.finalCode, finalStatus: test.finalStatus, attempts });
    const factorText = confidence.factors.map((factor) => `${factor.label} ${factor.points >= 0 ? '+' : ''}${factor.points}`).join(' · ');
    return `<article><h3>${h(test.testCaseId)} — ${h(title)}</h3><p>${badge(test.finalStatus)} · ${test.totalAttempts} attempt(s) · Confidence: ${confidenceBadge(confidence.score, confidence.band)}</p><p class="muted">${h(factorText)}</p>${code(test.finalCode)}<h4>Attempt history</h4>${history}</article>`;
  }).join('');
  const timeline = job.agentSteps.map((step) => `<tr>
    <td>${h(step.createdAt.toISOString())}</td><td>${h(step.stepType)}</td><td>${h(step.testCaseId ?? '—')} / ${h(step.attemptNumber ?? '—')}</td>
    <td>${badge(step.status)}</td><td>${h(step.latencyMs ?? '—')}</td><td>${h(step.llmProvider ?? '—')} / ${h(step.llmModel ?? '—')}</td>
    <td><pre>${h(step.errorDetail ?? '')}</pre></td></tr>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Agentic Test Case Generator — ${h(job.id)}</title>
  <style>${prismCss}
  :root{color-scheme:dark}body{margin:0 auto;padding:32px;max-width:1200px;background:#101722;color:#dce5f2;font:15px/1.6 system-ui,sans-serif}
  h1,h2,h3{line-height:1.25}section,article{padding:22px;margin:18px 0;background:#192333;border:1px solid #30415b;border-radius:10px}
  article{background:#121c2a}summary{cursor:pointer;padding:10px 0}details{border-top:1px solid #30415b;margin:10px 0}
  pre{white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;padding:14px;background:#0b1220;border-radius:6px}code{font-size:13px}
  table{width:100%;border-collapse:collapse;display:block;overflow:auto}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #30415b}
  td pre{margin:0;padding:0;background:none}.diff{font:13px/1.6 monospace}.muted{color:#a5b5ca}
  </style></head><body>
  <header><h1>Agentic Test Case Generator</h1><p>Job ${h(job.id)}</p><p>Target: ${h(job.targetUrl)}</p>
  <p>Status: ${badge(job.status)} · Start: ${h(job.startedAt?.toISOString() ?? '—')} · End: ${h(job.completedAt?.toISOString() ?? '—')} · Duration: ${duration}</p>
  ${job.errorMessage ? `<pre>${h(job.errorCode)}: ${h(job.errorMessage)}</pre>` : ''}</header>
  <section><h2>App Map Summary</h2>${map.success ? `<p>Interactive elements: ${map.data.totalElementsFound} found / ${map.data.elements.length} retained · Forms: ${map.data.forms.length} · Discovered links: ${map.data.discoveredLinks.length}</p>` : '<p>App Map unavailable.</p>'}</section>
  <section><h2>Test Plan Overview</h2>${cases.map((testCase) => `<details><summary>${h(testCase.id)} — ${h(testCase.title)} (${testCase.steps.length} steps)</summary><p>${h(testCase.description)}</p><ol>${testCase.steps.map((step) => `<li><strong>${h(step.action)}</strong> ${h(step.description)}${step.elementId ? ` · ${h(step.elementId)}` : ''}${step.value !== null ? ` · ${h(step.value)}` : ''}</li>`).join('')}</ol></details>`).join('') || '<p>Test plan unavailable.</p>'}</section>
  <section><h2>Test Results</h2>${tests || '<p>No completed test cases persisted.</p>'}</section>
  <section><h2>Token Usage</h2><p class="muted">Calls count provider attempts, including retries and planner repair. Failed requests with no usage returned have unknown token usage; totals include only reported tokens.</p>
  <table><thead><tr><th>Step</th><th>Calls</th><th>Prompt tokens</th><th>Completion tokens</th></tr></thead><tbody>${usageRows}<tr><th>Total</th><th>${llmSteps.length}</th><th>${totalPrompt}</th><th>${totalCompletion}</th></tr></tbody></table>
  <table><thead><tr><th>Provider</th><th>Model</th><th>Calls</th><th>Prompt tokens</th><th>Completion tokens</th></tr></thead><tbody>${tokenRows || '<tr><td colspan="5">No model calls recorded.</td></tr>'}</tbody></table></section>
  <section><h2>Agent Step Timeline</h2><table><thead><tr><th>Started at</th><th>Step</th><th>Test / attempt</th><th>Status</th><th>Latency ms</th><th>Provider / model</th><th>Error</th></tr></thead><tbody>${timeline}</tbody></table></section>
  <script>window.Prism={manual:true};</script><script>${prismJs}</script><script>Prism.highlightAll();</script>
  </body></html>`;
}

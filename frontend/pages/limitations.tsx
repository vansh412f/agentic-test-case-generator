import Link from 'next/link';
import { Seo } from '@/components/common/Seo';

const sections = [
  {
    title: 'What the crawler sees',
    body: [
      'The crawler captures a first-load snapshot of up to 200 interactive elements per page.',
      'Post-interaction UI elements (such as modals, toasts, dropdown menus, and dynamically inserted rows) are not mapped into the initial App Map — tests may assert on their text once triggered, but cannot target them as pre-mapped elements. Iframes and canvas-based UI are not detected.',
    ],
  },
  {
    title: 'Authentication and page test data',
    body: [
      'Initial DOM discovery crawls the submitted URL directly without pre-existing session cookies. You can supply per-page form inputs and login credentials on the crawl preview screen before generating tests.',
      'Values marked as secret are replaced with __AGT_SECRET_n__ placeholders before planning or storage and injected only into ephemeral spec files at execution time. Password fields without user-supplied values are never filled with invented passwords and are covered only with empty/validation scenarios.',
    ],
  },
  {
    title: 'How tests run',
    body: [
      'Tests execute in headless Chromium at a fixed viewport of 1280×720. Hosted test executions run inside an isolated Google Cloud Run browser container with a 30-second per-test timeout under RUNNER_TIMEOUT_SCALE=2 (local default is 15 seconds).',
      'The agent performs at most 2 automatic self-corrections per test (up to 3 total attempts). Corrections only adjust selectors, waits, and timing to resolve mechanical flakiness; AST guards prevent modifications to test assertions, and unresolved assertion discrepancies are reported as findings.',
      'Every execution attempt captures an owner-only Playwright trace archive retained in ephemeral storage for 1 hour (capped at 200 traces / 256 MiB FIFO eviction).',
    ],
  },
  {
    title: 'Generated test output',
    body: [
      'Because test plans and fallback specs are synthesized using hosted language models, outputs can vary across runs. Review all generated tests before adding them to continuous integration pipelines.',
      'Tests may submit forms or click interactive buttons that could alter application state.',
    ],
  },
  {
    title: 'Free hosting',
    body: [
      'On hosted deployments, the API server stays warm via health monitoring while the isolated remote Chromium container scales to zero when idle (adding ~1–2 seconds on cold wake). Shared daily limits (8 runs per visitor, 20 per IP, 40 global) apply unless you supply your own Groq or Google Gemini key (held only in your browser sessionStorage for the active tab).',
      'Any test run in progress during a backend deployment or restart is marked as failed.',
    ],
  },
  {
    title: 'Local applications',
    body: [
      'The hosted cloud demo cannot directly access localhost or private internal network addresses.',
      'To generate tests for local applications, switch to Local Agent mode or establish a secure public tunnel using Cloudflare Tunnels or ngrok.',
    ],
  },
  {
    title: 'What is sent to model providers',
    body: [
      'During automated test planning and repair passes, page element summaries, structural outlines, and non-secret test data are sent to configured model providers (Groq and Google Gemini).',
      'Free-tier model provider policies may log or retain prompts and outputs unless you use paid BYOK accounts.',
      'Sensitive values marked as secrets are never sent to model providers. They are masked via __AGT_SECRET_n__ placeholders before any external model call and substituted strictly in memory during execution.',
    ],
  },
];

export default function LimitationsPage() {
  return (
    <>
      <Seo
        description="Known limitations and operational scope of Agentic Test Case Generator, covering crawling, authentication, test execution, automated test generation, and local access."
        path="/limitations"
        title="Known Limitations — Agentic Test Case Generator"
      />

      <article className="mx-auto max-w-reading py-section-sm">
        <p className="font-mono text-caption uppercase tracking-widest text-brand-strong dark:text-brand">
          Scope
        </p>

        <h1 className="mt-4 text-heading-1 font-bold">Known limitations</h1>

        <p className="mt-4 text-body text-muted-foreground">
          A clear reference of current capabilities, crawler boundaries, execution
          assumptions, and operational constraints.
        </p>

        {sections.map((section) => (
          <section className="mt-10" key={section.title}>
            <h2 className="text-heading-2 font-bold">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p className="mt-3 text-body text-muted-foreground" key={paragraph}>
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <section className="mt-10 rounded-panel border bg-surface p-6">
          <h2 className="text-card-title font-bold">Feedback and issues</h2>
          <p className="mt-2 text-body text-muted-foreground">
            Found an edge case or have a question? File an issue on our{' '}
            <a
              className="underline hover:text-foreground"
              href="https://github.com/vansh412f/agentic-test-case-generator/issues"
              rel="noreferrer"
              target="_blank"
            >
              GitHub repository
            </a>{' '}
            or{' '}
            <Link className="underline hover:text-foreground" href="/">
              try another page
            </Link>
            .
          </p>
        </section>
      </article>
    </>
  );
}

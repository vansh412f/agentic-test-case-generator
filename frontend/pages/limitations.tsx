import Link from 'next/link';
import { Seo } from '@/components/common/Seo';

const sections = [
  {
    title: 'What the crawler sees',
    body: [
      'The crawler captures a first-load snapshot of up to 200 interactive elements per page. In deep crawl mode, it maps up to 2 additional linked pages within the same site.',
      'Post-interaction UI elements (such as modals, toasts, dropdown menus, and dynamically inserted rows) are not mapped into the initial App Map — tests may assert on their text once triggered, but cannot target them as pre-mapped elements. Iframes and canvas-based UI are not detected.',
    ],
  },
  {
    title: 'Authentication',
    body: [
      'The crawler cannot log in to your application. To generate tests for authenticated journeys, provide a staging or preview URL that is accessible without an active session or credentials.',
    ],
  },
  {
    title: 'How tests run',
    body: [
      'Tests execute in headless Chromium at a fixed viewport of 1280×720 with a 15-second timeout per test.',
      'The agent performs at most 2 automatic self-corrections per test. Corrections only adjust selectors, waits, and timing to resolve mechanical flakiness; they never modify or weaken test assertions. Tests that continue to fail after corrections are reported as genuine findings.',
    ],
  },
  {
    title: 'AI-generated output',
    body: [
      'Because test plans and code are synthesized by large language models, outputs may vary between runs. Review all generated tests before adding them to continuous integration pipelines.',
      'Tests may submit forms or click interactive buttons that could alter application state.',
    ],
  },
  {
    title: 'Free hosting',
    body: [
      'On free-tier hosting deployments, the server may sleep when idle; the first request can take up to a minute to wake up. Shared daily quotas apply unless you supply your own Groq or Gemini API key.',
      'Any test run in progress during a server deployment or restart is marked as failed.',
    ],
  },
  {
    title: 'Local applications',
    body: [
      'The hosted cloud demo cannot directly access localhost or private internal network addresses.',
      'To generate tests for local applications, switch to Local Agent mode or establish a secure public tunnel using Cloudflare Tunnels or ngrok.',
    ],
  },
];

export default function LimitationsPage() {
  return (
    <>
      <Seo
        description="Known limitations and operational scope of Agentic Test Case Generator, covering crawling, authentication, test execution, AI generation, and local access."
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

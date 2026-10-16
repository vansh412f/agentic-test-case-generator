import { Bot, FileDown, ScanSearch } from 'lucide-react';
import { Reveal } from '@/components/common/Reveal';

export function HowItWorks() {
  return (
    <Reveal>
      <section aria-labelledby="how-it-works-title" className="py-section">
        <div className="max-w-reading">
          <p className="font-mono text-caption uppercase tracking-widest text-brand-strong dark:text-brand">
            Observe · Plan · Act · Reflect
          </p>
          <h2 className="mt-3 text-heading-1 font-bold" id="how-it-works-title">
            Not a single prompt. A controlled test-generation loop.
          </h2>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-how-desktop">
          <article className="panel p-6 sm:p-8">
            <ScanSearch aria-hidden="true" className="h-8 w-8 text-brand-strong dark:text-brand" />
            <h3 className="mt-5 text-heading-2 font-bold">
              01 — Observe the real application
            </h3>
            <p className="mt-3 max-w-reading text-body text-muted-foreground">
              Playwright crawls your running app and builds an App Map of real
              buttons, forms, inputs, links, labels, placeholders, roles, and
              test IDs. The planner only receives element IDs that actually
              exist.
            </p>

            <div className="mt-6 rounded-panel border bg-background p-4 font-mono text-small">
              <p>getByPlaceholder(&apos;What needs to be done?&apos;)</p>
              <p className="mt-2 text-muted-foreground">
                elem-3 → textbox → visible → enabled
              </p>
            </div>
          </article>

          <div className="grid gap-4">
            <article className="panel p-6">
              <Bot aria-hidden="true" className="h-7 w-7 text-info" />
              <h3 className="mt-4 text-card-title font-bold">
                02 — Generate, execute, self-correct
              </h3>
              <p className="mt-2 text-small text-muted-foreground">
                Each test is type-checked before a browser launches. Mechanical
                locator and timing failures are corrected; real application
                findings are never rewritten away.
              </p>
            </article>

            <article className="panel p-6">
              <FileDown aria-hidden="true" className="h-7 w-7 text-success" />
              <h3 className="mt-4 text-card-title font-bold">
                03 — Export a runnable project
              </h3>
              <p className="mt-2 text-small text-muted-foreground">
                Download the self-contained HTML report or a Playwright project
                containing the generated specs and configuration.
              </p>
            </article>
          </div>
        </div>
      </section>
    </Reveal>
  );
}

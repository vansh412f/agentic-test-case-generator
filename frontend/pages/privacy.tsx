import { toast } from 'sonner';
import { Seo } from '@/components/common/Seo';
import { forgetAllRememberedTestData } from '@/lib/rememberedTestData';

const sections = [
  {
    title: 'Information processed',
    body: [
      'Agentic Test Case Generator processes the target URLs you submit, the structure of the web pages you ask it to crawl, generated Playwright test code, execution results, correction history, token-usage metadata, and downloadable reports.',
      'You should only submit applications, staging environments, and accounts that you own or are authorized to test.',
    ],
  },
  {
    title: 'Application content and credentials',
    body: [
      'The crawler observes visible interactive elements and form structure. You must not submit production secrets, real customer data, or credentials that you are not authorized to use for automated testing.',
      'Generated tests may reproduce text and values needed to execute the workflows you selected. Review every generated test and report before sharing it.',
    ],
  },
  {
    title: 'AI processing',
    body: [
      'Structured application maps and test plans are sent to configured large-language-model providers so the service can plan, generate, and correct test code. Provider handling may vary by deployment configuration.',
      'Do not use the service with applications containing regulated, confidential, or personal data unless your deployment and provider agreements permit that processing.',
    ],
  },
  {
    title: 'Reports and exports',
    body: [
      'HTML reports and exported Playwright projects are generated from your job data. Anyone with access to those files may be able to inspect target URLs, application text, generated code, and execution errors.',
      'Store and distribute reports and exports using the same controls you apply to source code and internal QA artifacts.',
    ],
  },
  {
    title: 'Retention and deletion',
    body: [
      'Job records may be retained so you can review historical results, compare corrections, and download deliverables. Retention periods depend on the operator of the deployment you are using.',
      'To request deletion of job data, contact the operator of this deployment and provide the relevant job IDs and target URLs.',
    ],
  },
  {
    title: 'Security',
    body: [
      'Use localhost or access-controlled staging environments whenever possible. Generated tests can create, modify, or delete application data depending on the workflows they execute.',
      'Review generated tests before running them against any shared environment.',
    ],
  },
  {
    title: 'Changes to this policy',
    body: [
      'This policy may be updated as the product, deployment model, or data-processing practices change. The date below identifies the current version.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <>
      <Seo
        description="How Agentic Test Case Generator processes target URLs, application maps, generated tests, reports, and AI requests."
        path="/privacy"
        title="Privacy Policy — Agentic Test Case Generator"
      />

      <article className="mx-auto max-w-reading py-section-sm">
        <p className="font-mono text-caption uppercase tracking-widest text-brand-strong dark:text-brand">
          Legal
        </p>

        <h1 className="mt-4 text-heading-1 font-bold">Privacy Policy</h1>

        <p className="mt-4 text-body text-muted-foreground">
          Last updated: 16 October 2026
        </p>

        <p className="mt-6 text-body text-muted-foreground">
          This policy explains what information the Agentic Test Case
          Generator processes when you crawl an application, generate tests,
          execute them, and download reports or test projects.
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
          <h2 className="text-card-title font-bold">Locally Remembered Test Data</h2>
          <p className="mt-2 text-body text-muted-foreground">
            Any credentials and input values you enter on the crawl preview screen are stored strictly in your browser’s localStorage for up to 30 days to save you time when re-testing the same site. They are never sent to third parties or stored on the server.
          </p>
          <button
            type="button"
            onClick={() => {
              forgetAllRememberedTestData();
              toast.success('All remembered test data cleared from this browser');
            }}
            className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20"
          >
            Forget all remembered test data
          </button>
        </section>

        <section className="mt-10 rounded-panel border bg-surface p-6">
          <h2 className="text-card-title font-bold">Operator contact</h2>
          <p className="mt-2 text-body text-muted-foreground">
            Privacy and deletion requests should be sent to the operator of
            the deployment you used. Include the relevant job ID so the
            correct records can be identified.
          </p>
        </section>
      </article>
    </>
  );
}

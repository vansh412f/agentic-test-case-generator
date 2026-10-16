import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { HowItWorksVariantsShowcase } from './how-it-works-variants/HowItWorksVariantsShowcase';

const steps = [
  {
    n: '01',
    title: 'Crawl',
    desc: 'Discovers interactive elements, forms, and internal pages.',
    example: '18 elements · 1 form discovered',
  },
  {
    n: '02',
    title: 'Plan',
    desc: 'Turns DOM evidence into structured user-journey test cases.',
    example: 'Test case: “Add new todo item”',
  },
  {
    n: '03',
    title: 'Generate',
    desc: 'Writes Playwright TypeScript using only verified crawl locators.',
    example: "page.getByRole('button', { name: 'Add' })",
  },
  {
    n: '04',
    title: 'Validate',
    desc: 'Compiles with the TypeScript compiler before a browser launches.',
    example: '✓ PASS · tsc --noEmit',
  },
  {
    n: '05',
    title: 'Self-Correction',
    desc: 'Retries mechanical failures with browser error context.',
    example: 'locator timeout → corrected · assertions unchanged',
  },
];

export function HowItWorks() {
  const shouldReduceMotion = useReducedMotion();

  const cardVariants: Variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 20 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: shouldReduceMotion ? 0 : i * 0.08,
        duration: shouldReduceMotion ? 0 : 0.45,
        ease: 'easeOut' as const,
      },
    }),
  };

  return (
    <>
      <section aria-labelledby="how-it-works-title" className="how" id="how-it-works">
      <motion.div
        className="how-heading"
        initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 18 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.45, ease: 'easeOut' }}
        viewport={{ once: true, margin: '-60px' }}
        whileInView={{ opacity: 1, y: 0 }}
      >
        <h2 id="how-it-works-title">How It Works</h2>
        <p className="section-lead">
          An autonomous agent turns a live web app into self-healing Playwright test suites, grounded in real DOM evidence—not guessed selectors.
        </p>
      </motion.div>

      <div className="loop-heading">
        <span>THE EXECUTION LOOP</span>
        <small>Live application → runnable test suite</small>
      </div>

      <div className="loop-grid">
        {steps.map((step, index) => (
          <motion.div
            className="loop-card"
            custom={index}
            initial="hidden"
            key={step.n}
            variants={cardVariants}
            viewport={{ once: true, margin: '-50px' }}
            whileInView="visible"
          >
            <div className="card-depth" />
            <div className="loop-number">{step.n}</div>
            <h3>{step.title}</h3>
            <p>{step.desc}</p>
            <code>{step.example}</code>
          </motion.div>
        ))}
      </div>

      <motion.div
        className="taxonomy-wrap"
        initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 24 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.5, ease: 'easeOut' }}
        viewport={{ once: true, margin: '-60px' }}
        whileInView={{ opacity: 1, y: 0 }}
      >
        <div>
          <div className="section-kicker">FAILURE TAXONOMY</div>
          <h2>Real bugs are never masked.</h2>
          <p className="taxonomy-intro">
            Every failure is classified from browser output and test intent before the agent decides whether correction is allowed.
          </p>

          <div className="taxonomy">
            <div>
              <i className="red" />
              <span>
                <strong>
                  Finding <b>REAL APPLICATION BUG</b>
                </strong>
                <small>
                  Assertion failures and server errors are genuine defects. They are never rewritten or corrected—only surfaced as findings with evidence.
                </small>
              </span>
            </div>

            <div>
              <i className="amber" />
              <span>
                <strong>
                  Locator &amp; Timeout <b>MECHANICAL</b>
                </strong>
                <small>
                  Flaky selectors and DOM timing issues are sent to the corrector with browser logs and retried up to 2×.
                </small>
              </span>
            </div>

            <div>
              <i className="green" />
              <span>
                <strong>Assertion Preservation Guard</strong>
                <small>
                  Corrected code must retain 100% of the original assertions. Any revision that weakens test intent is rejected.
                </small>
              </span>
            </div>
          </div>
        </div>

        <div className="cost-card">
          <span className="mini-label">MEASURED TOKEN ECONOMY</span>
          <div className="cost-equation">
            <strong>~14,500</strong>
            <i>tokens</i>
            <em>≈</em>
            <strong>$0.004</strong>
            <i>per suite</i>
          </div>
          <hr />
          <p className="cost-lifecycle">
            <span>Observe DOM</span>
            <b>→</b>
            <span>Plan journey</span>
            <b>→</b>
            <span>Generate TypeScript</span>
            <b>→</b>
            <span>Validate</span>
            <b>→</b>
            <span>Execute</span>
            <b>→</b>
            <span>Self-correct</span>
          </p>
          <small>
            Covers the full test-suite lifecycle, including correction attempts. Estimate varies with application size and model pricing.
          </small>
        </div>
      </motion.div>
    </section>

    {/* 11 Alternative Design Variants for User Review */}
    <HowItWorksVariantsShowcase />
    </>
  );
}

export default HowItWorks;


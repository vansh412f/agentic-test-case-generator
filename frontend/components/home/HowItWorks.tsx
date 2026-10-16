import Link from 'next/link';
import { motion, type Variants } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle,
  Coins,
  Cpu,
  Info,
  ShieldCheck,
  Warning,
  Wrench,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.45,
      ease: 'easeOut',
    },
  },
};

export function HowItWorks() {
  function scrollToTopInput() {
    const input = document.getElementById('target-url');
    if (input) {
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input.focus();
    }
  }

  return (
    <section
      aria-labelledby="how-it-works-title"
      className="py-section scroll-mt-20 border-t"
      id="how-it-works"
    >
      <motion.div
        className="max-w-reading"
        initial={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        viewport={{ once: true, margin: '-80px' }}
        whileInView={{ opacity: 1, y: 0 }}
      >
        <p className="font-mono text-caption uppercase tracking-widest text-brand-strong dark:text-brand">
          Architecture · Taxonomy · Cost
        </p>
        <h2 className="mt-3 text-heading-1 font-bold" id="how-it-works-title">
          How It Works: An Autonomous, Self-Healing Loop
        </h2>
        <p className="mt-4 text-body text-muted-foreground leading-relaxed">
          Unlike one-shot AI prompts that guess selectors, our multi-step agent crawls your live
          DOM, grounds plans in verified locators, executes tests in real Chromium instances, and
          self-heals mechanical failures without ever altering your assertions.
        </p>
      </motion.div>

      {/* 1. The Loop with Real Evidence & Stepped Replay */}
      <div className="mt-10 grid gap-6 lg:grid-cols-how-desktop items-start">
        <div className="panel p-6 sm:p-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            viewport={{ once: true, margin: '-80px' }}
            whileInView={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center gap-3">
              <Cpu aria-hidden="true" className="h-7 w-7 text-brand" weight="duotone" />
              <h3 className="text-heading-2 font-bold">The Execution Loop</h3>
            </div>
            <p className="mt-3 text-small text-muted-foreground leading-relaxed">
              Every generation job runs through five rigorous stages. Code is compiled and
              statically validated via the TypeScript compiler before any browser launches.
            </p>
          </motion.div>

          <motion.div
            className="mt-6 space-y-3 font-mono text-small"
            initial="hidden"
            variants={containerVariants}
            viewport={{ once: true, margin: '-80px' }}
            whileInView="visible"
          >
            <motion.div className="flex items-center gap-2 rounded-md border bg-surface px-3 py-2" variants={itemVariants}>
              <span className="text-muted-foreground">01 CRAWL</span>
              <span className="text-foreground">18 elements · 1 form discovered</span>
            </motion.div>
            <motion.div className="flex items-center gap-2 rounded-md border bg-surface px-3 py-2" variants={itemVariants}>
              <span className="text-muted-foreground">02 PLAN</span>
              <span className="text-info">tc-1 Add new todo item</span>
            </motion.div>
            <motion.div className="rounded-md border bg-surface px-3 py-2" variants={itemVariants}>
              <div className="text-muted-foreground">03 GENERATE</div>
              <div className="text-brand text-caption truncate mt-1">
                page.getByPlaceholder(&apos;What needs to be done?&apos;)
              </div>
            </motion.div>
            <motion.div className="flex items-center justify-between rounded-md border bg-surface px-3 py-2" variants={itemVariants}>
              <span className="text-muted-foreground">04 VALIDATE</span>
              <span className="text-success font-semibold flex items-center gap-1">
                <CheckCircle aria-hidden="true" className="h-4 w-4" weight="duotone" /> PASS
              </span>
            </motion.div>
            <motion.div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-caption" variants={itemVariants}>
              <div className="flex items-center gap-1.5 font-semibold text-warning">
                <Wrench aria-hidden="true" className="h-4 w-4" weight="duotone" />
                05 SELF-CORRECTION
              </div>
              <p className="mt-1 text-muted-foreground">
                locator timeout on getByTestId(&apos;submit-btn&apos;) → corrected, assertions unchanged.
              </p>
            </motion.div>
          </motion.div>
        </div>

        {/* 2. Failure Taxonomy — Architectural Centerpiece */}
        <div className="space-y-6">
          <div className="panel p-6">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
              viewport={{ once: true, margin: '-80px' }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center gap-2.5">
                <ShieldCheck aria-hidden="true" className="h-6 w-6 text-brand" weight="duotone" />
                <h3 className="text-card-title font-bold">Guarded Failure Taxonomy</h3>
              </div>
              <p className="mt-2 text-small text-muted-foreground leading-relaxed">
                The agent never masks application defects. Failures are strictly classified before correction is considered:
              </p>
            </motion.div>

            <motion.div
              className="mt-4 space-y-3"
              initial="hidden"
              variants={containerVariants}
              viewport={{ once: true, margin: '-80px' }}
              whileInView="visible"
            >
              <motion.div className="rounded-md border border-danger/40 bg-danger/5 p-3" variants={itemVariants}>
                <div className="flex items-center gap-1.5 font-semibold text-danger text-small">
                  <Warning aria-hidden="true" className="h-4 w-4" weight="duotone" />
                  Finding (Real Application Bug)
                </div>
                <p className="mt-1 text-caption text-muted-foreground">
                  Assertion differences or 5xx server errors represent genuine bugs. They are never rewritten or corrected; they are surfaced as actionable findings.
                </p>
              </motion.div>

              <motion.div className="rounded-md border border-warning/40 bg-warning/5 p-3" variants={itemVariants}>
                <div className="flex items-center gap-1.5 font-semibold text-warning text-small">
                  <Wrench aria-hidden="true" className="h-4 w-4" weight="duotone" />
                  Locator &amp; Timeout (Mechanical)
                </div>
                <p className="mt-1 text-caption text-muted-foreground">
                  Flaky selectors or DOM race conditions are fed to the corrector agent with browser logs, retrying up to 2×.
                </p>
              </motion.div>

              <motion.div className="rounded-md border border-brand/40 bg-brand/5 p-3" variants={itemVariants}>
                <div className="flex items-center gap-1.5 font-semibold text-brand text-small">
                  <ShieldCheck aria-hidden="true" className="h-4 w-4" weight="duotone" />
                  Assertion Preservation Guard
                </div>
                <p className="mt-1 text-caption text-muted-foreground">
                  An AST-level validation ensures that corrected specs retain 100% of original test assertions. Any attempt to weaken assertions is rejected immediately.
                </p>
              </motion.div>
            </motion.div>
          </div>

          {/* 3. Measured Cost */}
          <motion.div
            className="panel p-6 border bg-surface-elevated/30"
            initial={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.28 }}
            viewport={{ once: true, margin: '-80px' }}
            whileInView={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center gap-2">
              <Coins aria-hidden="true" className="h-5 w-5 text-brand" weight="duotone" />
              <h3 className="font-semibold text-small">Measured Token Economy</h3>
            </div>
            <p className="mt-2 font-mono text-small text-foreground">
              ~14,500 tokens ≈ $0.004 per test suite
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              Full lifecycle: observe DOM → plan journey → generate TypeScript → validate syntax → execute Playwright → self-correct.
            </p>
          </motion.div>
        </div>
      </div>

      {/* 4. Honest Limitations */}
      <div className="panel mt-6 p-6 border-muted-foreground/20 bg-muted/20">
        <div className="flex items-start gap-3">
          <Info aria-hidden="true" className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" weight="duotone" />
          <div className="text-small text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Honest Limitations: </strong>
            This hosted demo cannot reach your machine&apos;s <code className="font-mono text-caption">localhost</code> directly — use Cloudflare Quick Tunnel or Local Agent mode.
            The shared free-tier is capped at 20 public generations/day; supply your own Groq/Gemini key in the header to bypass global limits.
            Intended for development and staging environments.
          </div>
        </div>
      </div>

      {/* 5. CTA Row */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
        <div className="flex items-center gap-3">
          <Button onClick={scrollToTopInput} size="default">
            Generate a suite
          </Button>
          <Link
            className="inline-flex min-h-11 items-center gap-2 rounded-control px-4 text-small font-medium transition-colors hover:bg-muted"
            href="/jobs"
          >
            Browse real runs
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>

        <span className="font-mono text-caption text-muted-foreground">
          No credit card · Free APIs · Open Source
        </span>
      </div>
    </section>
  );
}

export default HowItWorks;

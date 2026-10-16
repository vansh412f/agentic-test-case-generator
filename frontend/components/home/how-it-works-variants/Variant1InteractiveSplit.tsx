import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MagnifyingGlass,
  TreeStructure,
  Code,
  CheckCircle,
  ArrowsClockwise,
  Copy,
  Check,
} from '@phosphor-icons/react';

interface Step {
  id: string;
  num: string;
  title: string;
  subtitle: string;
  desc: string;
  metric: string;
  icon: typeof MagnifyingGlass;
  codeSnippet: string;
  filename: string;
  tag: string;
}

const steps: Step[] = [
  {
    id: 'crawl',
    num: '01',
    title: 'DOM Observation & Evidence',
    subtitle: 'Headless Playwright Crawler',
    desc: 'Launches a headless browser to explore the live web application, cataloging every clickable button, form input, navigation anchor, and accessible ARIA role.',
    metric: '18 elements · 4 forms extracted',
    icon: MagnifyingGlass,
    filename: 'crawl-evidence.json',
    tag: 'EXPLORATION',
    codeSnippet: `// Extracted live DOM evidence
{
  "url": "https://acme-store.app/catalog",
  "elements": [
    { "role": "button", "name": "Add to Cart", "locator": "page.getByRole('button', { name: 'Add to Cart' })" },
    { "role": "textbox", "name": "Quantity", "locator": "page.getByLabel('Quantity')" },
    { "role": "link", "name": "Checkout", "locator": "page.getByRole('link', { name: 'Checkout' })" }
  ]
}`,
  },
  {
    id: 'plan',
    num: '02',
    title: 'User-Journey Synthesis',
    subtitle: 'Grounded LLM Reasoning',
    desc: 'Transforms physical DOM elements into realistic end-to-end user journeys with clear prerequisites, interactive sequences, and strict success assertions.',
    metric: '5 test cases synthesized',
    icon: TreeStructure,
    filename: 'test-plan.json',
    tag: 'PLANNING',
    codeSnippet: `// Autonomous Journey Plan
{
  "testCaseId": "tc-001",
  "title": "Guest adds featured product to shopping cart",
  "intent": "Verify cart counter increments and modal appears",
  "steps": [
    "Navigate to product detail page",
    "Click 'Add to Cart' button",
    "Assert cart badge text equals '1'"
  ]
}`,
  },
  {
    id: 'generate',
    num: '03',
    title: 'Playwright TypeScript Synthesis',
    subtitle: 'Zero-Guessing Locators',
    desc: 'Generates robust Playwright TypeScript test suites using exclusively verified locators extracted during crawl—no invented selectors or guessing.',
    metric: '100% typed Playwright code',
    icon: Code,
    filename: 'cart.spec.ts',
    tag: 'CODEGEN',
    codeSnippet: `import { test, expect } from '@playwright/test';

test('guest adds featured product to shopping cart', async ({ page }) => {
  await page.goto('https://acme-store.app/catalog');
  await page.getByRole('button', { name: 'Add to Cart' }).click();
  
  const cartBadge = page.getByTestId('cart-counter');
  await expect(cartBadge).toHaveText('1');
});`,
  },
  {
    id: 'validate',
    num: '04',
    title: 'Static Compiler Validation',
    subtitle: 'Ahead-of-Time tsc Verification',
    desc: 'Runs the TypeScript compiler against generated test files inside an isolated sandbox before any browser launches, catching syntax errors and locator type mismatches.',
    metric: '✓ PASS · tsc --noEmit (0 errors)',
    icon: CheckCircle,
    filename: 'tsc-compile.log',
    tag: 'VALIDATION',
    codeSnippet: `$ tsc --noEmit --project tsconfig.json
Compiling specs...
[OK] cart.spec.ts (0 diagnostics)
[OK] checkout.spec.ts (0 diagnostics)
Static validation passed in 140ms.`,
  },
  {
    id: 'heal',
    num: '05',
    title: 'Self-Correction & Assertion Guard',
    subtitle: 'Autonomous Failure Healing',
    desc: 'When mechanical locator errors or timing delays occur, the agent retries with browser context logs. True application bugs are preserved and flagged as genuine findings.',
    metric: 'Assertion Preservation Guard: 100%',
    icon: ArrowsClockwise,
    filename: 'self-healing.diff',
    tag: 'HEALING',
    codeSnippet: `@@ -4,5 +4,5 @@
- await page.locator('.btn-add-cart').click(); // Timed out
+ await page.getByRole('button', { name: 'Add to Cart' }).click(); // Corrected
  
  // Assertion preserved 100% — never relaxed
  await expect(cartBadge).toHaveText('1');`,
  },
];

export function Variant1InteractiveSplit() {
  const [activeStepId, setActiveStepId] = useState<string>('generate');
  const [copied, setCopied] = useState(false);

  const activeStep = steps.find((s) => s.id === activeStepId) || steps[2];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeStep.codeSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="hiw-pattern-wrap">
      <div className="hiw-pattern-header">
        <span className="hiw-pattern-badge">DESIGN PATTERN 01</span>
        <h3>Interactive Split-Screen Stepper</h3>
        <p>Click any step on the left to inspect the live artifact, DOM evidence, or compiler verification on the right.</p>
      </div>

      <div className="hiw-split-container">
        {/* Left Side: Interactive Step Rails */}
        <div className="hiw-split-steps">
          {steps.map((step) => {
            const isActive = step.id === activeStepId;
            const IconComponent = step.icon;
            return (
              <button
                key={step.id}
                type="button"
                className={`hiw-split-step-btn ${isActive ? 'active' : ''}`}
                onClick={() => setActiveStepId(step.id)}
              >
                <div className="hiw-step-top">
                  <span className="hiw-step-num">{step.num}</span>
                  <span className="hiw-step-tag">{step.tag}</span>
                </div>
                <div className="hiw-step-main">
                  <div className="hiw-step-icon-wrap">
                    <IconComponent className="h-4 w-4" weight={isActive ? 'fill' : 'regular'} />
                  </div>
                  <div>
                    <h4 className="hiw-step-title">{step.title}</h4>
                    <p className="hiw-step-sub">{step.subtitle}</p>
                  </div>
                </div>
                {isActive && (
                  <motion.div
                    className="hiw-step-desc-wrap"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <p className="hiw-step-desc">{step.desc}</p>
                    <div className="hiw-step-metric-pill">
                      <span>{step.metric}</span>
                    </div>
                  </motion.div>
                )}
              </button>
            );
          })}
        </div>

        {/* Right Side: Live Artifact Viewer */}
        <div className="hiw-split-preview">
          <div className="hiw-preview-terminal">
            <div className="hiw-terminal-header">
              <div className="hiw-traffic-dots">
                <span className="dot dot-red" />
                <span className="dot dot-yellow" />
                <span className="dot dot-green" />
              </div>
              <span className="hiw-terminal-filename">{activeStep.filename}</span>
              <button
                type="button"
                className="hiw-terminal-copy-btn"
                onClick={handleCopy}
                aria-label="Copy snippet"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-[#527318]" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="hiw-terminal-content">
              <AnimatePresence mode="wait">
                <motion.pre
                  key={activeStep.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="hiw-code-block"
                >
                  <code>{activeStep.codeSnippet}</code>
                </motion.pre>
              </AnimatePresence>
            </div>

            <div className="hiw-terminal-footer">
              <span className="hiw-terminal-status">
                <span className="status-indicator-green" />
                Step {activeStep.num} active · {activeStep.subtitle}
              </span>
              <span className="hiw-terminal-engine">Agent Engine v2.0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Variant1InteractiveSplit;

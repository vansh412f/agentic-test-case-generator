import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CaretDown,
  Globe,
  Compass,
  Code,
  ShieldCheck,
  Heartbeat,
} from '@phosphor-icons/react';

interface Drawer {
  id: string;
  number: string;
  title: string;
  category: string;
  summary: string;
  icon: typeof Globe;
  details: string;
  visualSnippet: string;
}

const drawers: Drawer[] = [
  {
    id: 'd1',
    number: '01',
    title: 'Autonomous Browser Exploration & Element Mapping',
    category: 'PERCEPTION',
    summary: 'Launches headless Chromium to identify reachable paths, dynamic forms, and accessibility trees.',
    icon: Globe,
    details: 'Rather than inspecting static source files, the crawler interacts with the actual running DOM tree to detect dynamically rendered elements.',
    visualSnippet: `// Live DOM Snapshot Extracted
Locator Map:
• button[name="Add"] → role: button, accessible: true
• input[name="item"] → role: textbox, required: true
• a[href="/cart"]    → role: link, visible: true`,
  },
  {
    id: 'd2',
    number: '02',
    title: 'Structured Journey Planning & Intent Modeling',
    category: 'REASONING',
    summary: 'Constructs verified test cases with sequential preconditions, steps, and expected outcomes.',
    icon: Compass,
    details: 'Every step in the generated test journey is constrained strictly to the locators verified during the live crawl.',
    visualSnippet: `Journey Spec: "Add item and verify cart counter"
Precondition: User is on product catalog
Step 1: Click "Add to Cart" button
Step 2: Await cart update
Assertion: expect(cartBadge).toHaveText('1')`,
  },
  {
    id: 'd3',
    number: '03',
    title: 'TypeScript Playwright Test Suite Synthesis',
    category: 'SYNTHESIS',
    summary: 'Generates modern async/await Playwright tests using role-based accessible selectors.',
    icon: Code,
    details: 'Follows Playwright official best practices: prioritizing getByRole, getByLabel, and getByTestId before CSS fallbacks.',
    visualSnippet: `import { test, expect } from '@playwright/test';

test('cart badge updates', async ({ page }) => {
  await page.goto('https://acme.store');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('cart')).toHaveText('1');
});`,
  },
  {
    id: 'd4',
    number: '04',
    title: 'Sandboxed Ahead-of-Time Type Compilation',
    category: 'VERIFICATION',
    summary: 'Validates code syntax and types with tsc --noEmit inside an isolated execution container.',
    icon: ShieldCheck,
    details: 'Guarantees zero TypeScript compiler diagnostics before allocating valuable browser execution runtime.',
    visualSnippet: `$ tsc --noEmit
Analyzing cart.spec.ts...
Done in 110ms. 0 errors, 0 warnings.`,
  },
  {
    id: 'd5',
    number: '05',
    title: 'Self-Correction Engine & Assertion Preservation Guard',
    category: 'HEALING',
    summary: 'Autonomous healing for flaky locators while preserving 100% of the original assertions.',
    icon: Heartbeat,
    details: 'If a locator times out, browser console logs and DOM snapshots guide a targeted repair. Genuine application bugs are flagged as findings.',
    visualSnippet: `// Assertion Preservation Guard Active
Mechanical Failure: Locator timeout on '.old-btn'
Self-Healing Action: Corrected to getByRole('button', { name: 'Add' })
Assertion Policy: 100% Assertions Intact (Zero Weakened)`,
  },
];

export function Variant10AccordionDrawers() {
  const [openDrawerId, setOpenDrawerId] = useState<string>('d1');

  const toggle = (id: string) => {
    setOpenDrawerId((prev) => (prev === id ? '' : id));
  };

  return (
    <div className="hiw-pattern-wrap">
      <div className="hiw-pattern-header">
        <span className="hiw-pattern-badge">DESIGN PATTERN 10</span>
        <h3>Expandable Accordion Drawers</h3>
        <p>A clean vertical drawer layout with micro-visualizers providing deep insights into each subsystem.</p>
      </div>

      <div className="hiw-accordion-container">
        {drawers.map((drawer) => {
          const isOpen = drawer.id === openDrawerId;
          const IconComp = drawer.icon;

          return (
            <div key={drawer.id} className={`hiw-drawer-card ${isOpen ? 'open' : ''}`}>
              <button
                type="button"
                className="hiw-drawer-trigger"
                onClick={() => toggle(drawer.id)}
                aria-expanded={isOpen}
              >
                <div className="hiw-drawer-trigger-left">
                  <span className="hiw-drawer-num">{drawer.number}</span>
                  <div className="hiw-drawer-icon-wrap">
                    <IconComp className="h-4 w-4" />
                  </div>
                  <div className="hiw-drawer-title-group">
                    <span className="hiw-drawer-category">{drawer.category}</span>
                    <h4 className="hiw-drawer-title">{drawer.title}</h4>
                  </div>
                </div>
                <div className="hiw-drawer-trigger-right">
                  <CaretDown className={`hiw-drawer-caret ${isOpen ? 'rotated' : ''}`} />
                </div>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="content"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="hiw-drawer-content"
                  >
                    <div className="hiw-drawer-inner">
                      <div className="hiw-drawer-desc-col">
                        <p className="hiw-drawer-summary">{drawer.summary}</p>
                        <p className="hiw-drawer-details">{drawer.details}</p>
                      </div>
                      <div className="hiw-drawer-code-col">
                        <pre>
                          <code>{drawer.visualSnippet}</code>
                        </pre>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Variant10AccordionDrawers;

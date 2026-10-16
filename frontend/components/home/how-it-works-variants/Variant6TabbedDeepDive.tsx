import { useState } from 'react';
import {
  Compass,
  TreeStructure,
  Terminal,
  ShieldCheck,
  ArrowsClockwise,
} from '@phosphor-icons/react';

interface TabData {
  id: string;
  tabLabel: string;
  icon: typeof Compass;
  headline: string;
  lead: string;
  specs: { label: string; value: string }[];
  artifactLabel: string;
  artifactCode: string;
  guardrail: string;
}

const tabData: TabData[] = [
  {
    id: 'crawl',
    tabLabel: '01 Crawl',
    icon: Compass,
    headline: 'High-Fidelity DOM Discovery',
    lead: 'Spawns an isolated Chromium browser instance to extract DOM structure, forms, dynamic anchors, and ARIA roles without triggering bot guards.',
    specs: [
      { label: 'DISCOVERY DEPTH', value: '1-level canonical routes' },
      { label: 'ELEMENT LIMIT', value: 'Up to 100 interactive nodes' },
      { label: 'DOM PARSER', value: 'Playwright locator trees' },
      { label: 'TIME SPENT', value: '~2.8 seconds' },
    ],
    artifactLabel: 'Discovered DOM Elements Sample',
    artifactCode: `[
  { "tag": "button", "role": "button", "text": "Add to Cart", "accessible": true },
  { "tag": "input", "role": "searchbox", "placeholder": "Search items...", "accessible": true },
  { "tag": "a", "role": "link", "href": "/checkout", "accessible": true }
]`,
    guardrail: 'Rate-limited to 10 crawls per hour per IP to prevent spamming live servers.',
  },
  {
    id: 'plan',
    tabLabel: '02 Plan',
    icon: TreeStructure,
    headline: 'Grounded Journey Deduction',
    lead: 'Derives cohesive user journeys strictly based on the extracted DOM elements, ensuring zero hallucinated actions.',
    specs: [
      { label: 'MODEL BACKBONE', value: 'Groq (Llama-3.3-70b) / Gemini' },
      { label: 'TEMPERATURE', value: '0.1 (Strict Determinism)' },
      { label: 'PROMPT STRATEGY', value: 'JSON Schema Structured Output' },
      { label: 'TOKEN BUDGET', value: '~3,200 tokens' },
    ],
    artifactLabel: 'Structured Test Plan (JSON)',
    artifactCode: `{
  "title": "Guest checkout with credit card validation",
  "steps": [
    "Navigate to product catalog",
    "Select item 'Standard Tee'",
    "Assert cart items count increases to 1"
  ],
  "confidenceScore": 88
}`,
    guardrail: 'Rejects journeys containing interactive elements not found in the initial crawl.',
  },
  {
    id: 'codegen',
    tabLabel: '03 CodeGen',
    icon: Terminal,
    headline: 'Strict TypeScript Playwright Synthesis',
    lead: 'Synthesizes clean, maintainable Playwright test files using modern async/await syntax, web-first assertions, and standard locator hierarchy.',
    specs: [
      { label: 'LANGUAGE', value: 'TypeScript 5.x' },
      { label: 'FRAMEWORK', value: '@playwright/test' },
      { label: 'ASSERTION STYLE', value: 'Web-First expect(locator)...' },
      { label: 'LOCATOR POLICY', value: 'getByRole > getByTestId > text' },
    ],
    artifactLabel: 'Generated Playwright Spec',
    artifactCode: `import { test, expect } from '@playwright/test';

test('verify shopping cart updates correctly', async ({ page }) => {
  await page.goto('https://acme-store.app');
  await page.getByRole('button', { name: 'Add to Cart' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText('1');
});`,
    guardrail: 'Prohibits hard-coded sleeps (page.waitForTimeout) to prevent flaky timing.',
  },
  {
    id: 'validate',
    tabLabel: '04 Validate',
    icon: ShieldCheck,
    headline: 'Ahead-of-Time Type Compilation',
    lead: 'Validates generated code against the real TypeScript compiler inside a virtual sandbox before spinning up a headless browser.',
    specs: [
      { label: 'COMPILER', value: 'tsc --noEmit' },
      { label: 'DIAGNOSTICS', value: 'Zero tolerance (0 errors)' },
      { label: 'ENV SANDBOX', value: 'Isolated scoped directory' },
      { label: 'VERDICT TIME', value: '< 250ms' },
    ],
    artifactLabel: 'TypeScript Diagnostic Log',
    artifactCode: `$ tsc --noEmit --project tsconfig.json
Compiling cart.spec.ts...
0 diagnostics found. Types and syntax verified clean.
Ready for browser execution.`,
    guardrail: 'Immediate rejection if syntax, types, or missing imports are detected.',
  },
  {
    id: 'heal',
    tabLabel: '05 Self-Correction',
    icon: ArrowsClockwise,
    headline: 'Assertion-Preserving Self-Healing',
    lead: 'When mechanical issues like selector timeouts occur, browser logs feed into a targeted corrector prompt without modifying assertions.',
    specs: [
      { label: 'HEALING RETRIES', value: 'Up to 2 correction attempts' },
      { label: 'ASSERTION GUARD', value: '100% assertions preserved' },
      { label: 'BUG POLICY', value: 'Real defects flagged as findings' },
      { label: 'DIFF TRACKING', value: 'Unified git-style diff stored' },
    ],
    artifactLabel: 'Healed Selector Unified Diff',
    artifactCode: `@@ -4,4 +4,4 @@
- await page.locator('.cart-button-v2').click();
+ await page.getByRole('button', { name: 'Add to Cart' }).click();
  
  await expect(page.getByTestId('cart-count')).toHaveText('1');`,
    guardrail: 'Assertion Preservation Guard automatically discards any revision that weakens assertions.',
  },
];

export function Variant6TabbedDeepDive() {
  const [activeTabId, setActiveTabId] = useState('crawl');

  const active = tabData.find((t) => t.id === activeTabId) || tabData[0];
  const IconComp = active.icon;

  return (
    <div className="hiw-pattern-wrap">
      <div className="hiw-pattern-header">
        <span className="hiw-pattern-badge">DESIGN PATTERN 06</span>
        <h3>Technical Deep-Dive Switcher</h3>
        <p>Explore technical specifications, guardrails, and real-world artifacts for each step of the agent engine.</p>
      </div>

      <div className="hiw-tabbed-container">
        {/* Horizontal Navigation Tabs */}
        <div className="hiw-tabs-nav">
          {tabData.map((tab) => {
            const TabIcon = tab.icon;
            const isSelected = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                type="button"
                className={`hiw-tab-pill ${isSelected ? 'active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                <TabIcon className="h-4 w-4" weight={isSelected ? 'fill' : 'regular'} />
                <span>{tab.tabLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content Body */}
        <div className="hiw-tab-content">
          <div className="hiw-tab-left">
            <div className="hiw-tab-header">
              <div className="hiw-tab-icon-box">
                <IconComp className="h-5 w-5 text-[#527318]" />
              </div>
              <div>
                <h4>{active.headline}</h4>
                <p className="hiw-tab-lead">{active.lead}</p>
              </div>
            </div>

            <div className="hiw-tab-specs-grid">
              {active.specs.map((spec) => (
                <div key={spec.label} className="hiw-spec-item">
                  <span className="hiw-spec-label">{spec.label}</span>
                  <span className="hiw-spec-value">{spec.value}</span>
                </div>
              ))}
            </div>

            <div className="hiw-tab-guardrail">
              <span className="guardrail-badge">SAFETY GUARDRAIL</span>
              <p>{active.guardrail}</p>
            </div>
          </div>

          <div className="hiw-tab-right">
            <div className="hiw-tab-code-box">
              <div className="hiw-code-header">
                <span>{active.artifactLabel}</span>
              </div>
              <pre>
                <code>{active.artifactCode}</code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Variant6TabbedDeepDive;

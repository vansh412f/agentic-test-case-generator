import { useState } from 'react';
import {
  MagnifyingGlass,
  Code,
  ShieldCheck,
  Browser,
  LockKey,
  Lightning,
  CheckCircle,
} from '@phosphor-icons/react';

export function Variant4BentoGrid() {
  const [activeElementTag, setActiveElementTag] = useState<string>('button');

  return (
    <div className="hiw-pattern-wrap">
      <div className="hiw-pattern-header">
        <span className="hiw-pattern-badge">DESIGN PATTERN 04</span>
        <h3>Bento Grid Matrix</h3>
        <p>A multi-dimensional information grid detailing browser observation, compiler safety, and assertion guards.</p>
      </div>

      <div className="hiw-bento-grid">
        {/* Card 1: Large Span (DOM Observation) */}
        <div className="hiw-bento-card hiw-bento-span-2">
          <div className="hiw-bento-tag">STEP 01 · CRAWL</div>
          <div className="hiw-bento-header">
            <div className="hiw-bento-icon-box">
              <MagnifyingGlass className="h-5 w-5 text-[#527318]" />
            </div>
            <div>
              <h4>DOM Grounded Observation</h4>
              <p>Extracts living interactive targets rather than guessing fragile CSS selectors.</p>
            </div>
          </div>

          <div className="hiw-bento-chips-wrap">
            <span className="hiw-chips-label">Discovered element signatures:</span>
            <div className="hiw-chips-row">
              {['button[role="button"]', 'input[type="text"]', 'form#checkout', 'a[href="/catalog"]'].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`hiw-chip ${activeElementTag === tag ? 'active' : ''}`}
                  onClick={() => setActiveElementTag(tag)}
                >
                  <code>{tag}</code>
                </button>
              ))}
            </div>
          </div>

          <div className="hiw-bento-code-snippet">
            <code>
              {activeElementTag.includes('button')
                ? "page.getByRole('button', { name: 'Add to Cart' }) // Verified locator"
                : activeElementTag.includes('input')
                ? "page.getByLabel('Search products') // Accessible label locator"
                : "page.getByRole('link', { name: 'Catalog' }) // Canonical navigation link"}
            </code>
          </div>
        </div>

        {/* Card 2: TypeScript Compiler Guard */}
        <div className="hiw-bento-card">
          <div className="hiw-bento-tag">STEP 04 · COMPILE</div>
          <div className="hiw-bento-icon-box">
            <ShieldCheck className="h-5 w-5 text-[#0284c7]" />
          </div>
          <h4>Static Type Verification</h4>
          <p>Compiles with the real TypeScript engine before launching any browser.</p>
          <div className="hiw-bento-pill-status">
            <CheckCircle className="h-4 w-4 text-[#527318]" weight="fill" />
            <span>tsc --noEmit: 0 diagnostics</span>
          </div>
        </div>

        {/* Card 3: Headless Chromium Sandbox */}
        <div className="hiw-bento-card">
          <div className="hiw-bento-tag">EXECUTION</div>
          <div className="hiw-bento-icon-box">
            <Browser className="h-5 w-5 text-[#7c3aed]" />
          </div>
          <h4>Isolated Browser Runner</h4>
          <p>Executes inside disposable scoped temp directories with automatic resource cleanup.</p>
          <div className="hiw-bento-pill-status">
            <Lightning className="h-4 w-4 text-[#ea580c]" weight="fill" />
            <span>Concurrency semaphore capped at 2</span>
          </div>
        </div>

        {/* Card 4: Assertion Preservation Guard (Span 2) */}
        <div className="hiw-bento-card hiw-bento-span-2 hiw-bento-guard">
          <div className="hiw-bento-tag">STEP 05 · INTEGRITY</div>
          <div className="hiw-bento-header">
            <div className="hiw-bento-icon-box">
              <LockKey className="h-5 w-5 text-[#ea580c]" />
            </div>
            <div>
              <h4>Assertion Preservation Guard</h4>
              <p>Self-correction heals mechanical locator timeouts, but genuine bugs are protected as real findings.</p>
            </div>
          </div>

          <div className="hiw-bento-diff-compare">
            <div className="hiw-diff-side">
              <span className="hiw-diff-label red">Mechanical Failure (Healed)</span>
              <code>locator timeout → page.getByTestId(&apos;count&apos;)</code>
            </div>
            <div className="hiw-diff-divider">→</div>
            <div className="hiw-diff-side">
              <span className="hiw-diff-label green">Assertion Guarantee (Locked)</span>
              <code>expect(badge).toHaveText(&apos;1&apos;) [100% UNTOUCHED]</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Variant4BentoGrid;

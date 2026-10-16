import { useState } from 'react';
import { Check, X, ShieldCheck, Lightning } from '@phosphor-icons/react';

const comparisonRows = [
  {
    feature: 'Selector Generation',
    traditional: 'Guessed CSS/XPath selectors that break on class changes',
    agentic: 'Verified accessible ARIA locators extracted from live DOM',
    icon: Check,
  },
  {
    feature: 'Maintenance & Flakiness',
    traditional: 'Manual triage and editing when locators shift or time out',
    agentic: 'Autonomous self-healing using browser logs without user intervention',
    icon: Check,
  },
  {
    feature: 'Assertion Integrity',
    traditional: 'Temptation to relax or delete failing assertions to get green builds',
    agentic: 'Assertion Preservation Guard ensures 100% of test assertions remain locked',
    icon: ShieldCheck,
  },
  {
    feature: 'Type Safety & Validation',
    traditional: 'Runtime runtime failures discovered only after launching browsers',
    agentic: 'Ahead-of-time tsc typecheck validation in an isolated sandbox',
    icon: Check,
  },
  {
    feature: 'Time to First Suite',
    traditional: '2–4 days of manual test authoring per feature',
    agentic: '60 seconds autonomous crawl-to-spec generation',
    icon: Lightning,
  },
  {
    feature: 'Cost per Test Suite',
    traditional: '$150+ in engineering authoring & triage hours',
    agentic: '~$0.0035 in measured LLM token economy',
    icon: Check,
  },
];

export function Variant9ComparisonMatrix() {
  const [highlightAgentic, setHighlightAgentic] = useState(true);

  return (
    <div className="hiw-pattern-wrap">
      <div className="hiw-pattern-header">
        <span className="hiw-pattern-badge">DESIGN PATTERN 09</span>
        <h3>Comparison Matrix: Traditional QA vs Agentic Test</h3>
        <p>A side-by-side technical contrast between legacy manual test scripting and modern DOM-grounded autonomous generation.</p>
      </div>

      <div className="hiw-matrix-container">
        <div className="hiw-matrix-table">
          <div className="hiw-matrix-head">
            <div className="hiw-col-feature">CORE CAPABILITY</div>
            <div className="hiw-col-trad">TRADITIONAL MANUAL QA</div>
            <div className={`hiw-col-agentic ${highlightAgentic ? 'highlighted' : ''}`}>
              <span>AGENTIC TEST GENERATOR</span>
              <span className="hiw-matrix-badge">NEXT GEN</span>
            </div>
          </div>

          <div className="hiw-matrix-body">
            {comparisonRows.map((row) => (
              <div key={row.feature} className="hiw-matrix-row">
                <div className="hiw-col-feature">
                  <strong>{row.feature}</strong>
                </div>
                <div className="hiw-col-trad">
                  <div className="hiw-status-cross">
                    <X className="h-4 w-4 text-danger shrink-0" />
                    <span>{row.traditional}</span>
                  </div>
                </div>
                <div className={`hiw-col-agentic ${highlightAgentic ? 'highlighted' : ''}`}>
                  <div className="hiw-status-check">
                    <Check className="h-4 w-4 text-[#527318] shrink-0" />
                    <span>{row.agentic}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Variant9ComparisonMatrix;

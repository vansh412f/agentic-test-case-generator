import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  CaretLeft,
  CaretRight,
  Compass,
  Path,
  FileCode,
  ShieldCheck,
  Lifebuoy,
} from '@phosphor-icons/react';

const carouselCards = [
  {
    step: '01',
    category: 'HEADLESS CRAWL',
    title: 'Deep Application Mapping',
    description: 'Autonomous exploration probes internal routes, clicks dynamic tabs, and tracks responsive layouts without human scripts.',
    detail: 'Captures interactive elements, forms, and ARIA roles directly from live DOM.',
    code: 'page.getByRole("button", { name: "Submit" })',
    icon: Compass,
    accent: '#527318',
  },
  {
    step: '02',
    category: 'LLM REASONING',
    title: 'Grounded Journey Planning',
    description: 'LLM reasoning derives comprehensive user journeys grounded only in verified DOM evidence, ensuring zero hallucinated elements.',
    detail: 'Synthesizes happy paths, boundary validations, and error branches.',
    code: 'User adds item → asserts cart count increases',
    icon: Path,
    accent: '#0284c7',
  },
  {
    step: '03',
    category: 'CODE SYNTHESIS',
    title: 'Strict Playwright Generation',
    description: 'Produces production-grade TypeScript test files adhering to modern Playwright best practices and locator priority rules.',
    detail: 'Uses getByRole and getByTestId before falling back to CSS selectors.',
    code: 'await expect(page.locator("#status")).toBeVisible()',
    icon: FileCode,
    accent: '#7c3aed',
  },
  {
    step: '04',
    category: 'STATIC COMPILER',
    title: 'Sandboxed Type Validation',
    description: 'Runs tsc compiler checks inside an isolated virtual sandbox to verify zero syntax or type issues before browser spin-up.',
    detail: 'Eliminates 90% of trivial syntax bugs before wasting execution time.',
    code: 'tsc --noEmit (0 diagnostics returned)',
    icon: ShieldCheck,
    accent: '#16a34a',
  },
  {
    step: '05',
    category: 'SELF-HEALING',
    title: 'Assertion Preservation Guard',
    description: 'When locators timeout, the agent self-heals by analyzing browser logs, but never alters or relaxes test assertions.',
    detail: 'Real application defects are flagged as genuine findings, never swept under the rug.',
    code: 'Locator timeout corrected · Assertion preserved 100%',
    icon: Lifebuoy,
    accent: '#ea580c',
  },
];

export function Variant2GlassCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const prev = () => setCurrentIndex((i) => Math.max(0, i - 1));
  const next = () => setCurrentIndex((i) => Math.min(carouselCards.length - 1, i + 1));

  const progressPercent = ((currentIndex + 1) / carouselCards.length) * 100;

  return (
    <div className="hiw-pattern-wrap">
      <div className="hiw-pattern-header">
        <span className="hiw-pattern-badge">DESIGN PATTERN 02</span>
        <h3>Horizontal Glassmorphic Carousel</h3>
        <p>Swipe or navigate through the sequential execution stages with smooth glassmorphism and progress tracking.</p>
      </div>

      <div className="hiw-carousel-outer">
        {/* Controls Bar */}
        <div className="hiw-carousel-controls">
          <div className="hiw-progress-rail">
            <div className="hiw-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="hiw-carousel-nav-btns">
            <span className="hiw-carousel-counter">
              <b>{String(currentIndex + 1).padStart(2, '0')}</b> / {String(carouselCards.length).padStart(2, '0')}
            </span>
            <button
              type="button"
              className="hiw-nav-btn"
              onClick={prev}
              disabled={currentIndex === 0}
              aria-label="Previous step"
            >
              <CaretLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="hiw-nav-btn"
              onClick={next}
              disabled={currentIndex === carouselCards.length - 1}
              aria-label="Next step"
            >
              <CaretRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Carousel Viewport */}
        <div className="hiw-carousel-viewport" ref={containerRef}>
          <motion.div
            className="hiw-carousel-track"
            animate={{ x: `-${currentIndex * 340}px` }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          >
            {carouselCards.map((card, i) => {
              const IconComp = card.icon;
              const isCurrent = i === currentIndex;
              return (
                <div
                  key={card.step}
                  className={`hiw-glass-card ${isCurrent ? 'active-card' : ''}`}
                  onClick={() => setCurrentIndex(i)}
                >
                  <div className="hiw-glass-top">
                    <span className="hiw-glass-step">{card.step}</span>
                    <span className="hiw-glass-category">{card.category}</span>
                  </div>
                  <div className="hiw-glass-icon" style={{ color: card.accent }}>
                    <IconComp className="h-6 w-6" weight="duotone" />
                  </div>
                  <h4 className="hiw-glass-title">{card.title}</h4>
                  <p className="hiw-glass-desc">{card.description}</p>
                  <div className="hiw-glass-detail">
                    <span>{card.detail}</span>
                  </div>
                  <div className="hiw-glass-code">
                    <code>{card.code}</code>
                  </div>
                </div>
              );
            })}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default Variant2GlassCarousel;

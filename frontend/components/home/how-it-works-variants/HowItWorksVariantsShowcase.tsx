import { useState } from 'react';
import Variant1InteractiveSplit from './Variant1InteractiveSplit';
import Variant2GlassCarousel from './Variant2GlassCarousel';
import Variant3OrbitalBrain from './Variant3OrbitalBrain';
import Variant4BentoGrid from './Variant4BentoGrid';
import Variant5PipelineFlow from './Variant5PipelineFlow';
import Variant6TabbedDeepDive from './Variant6TabbedDeepDive';
import Variant7IsometricStack from './Variant7IsometricStack';
import Variant8TerminalStoryboard from './Variant8TerminalStoryboard';
import Variant9ComparisonMatrix from './Variant9ComparisonMatrix';
import Variant10AccordionDrawers from './Variant10AccordionDrawers';
import Variant11ExecutionSimulator from './Variant11ExecutionSimulator';

const variantsNav = [
  { id: 'v1', label: '01 Split Stepper' },
  { id: 'v2', label: '02 Glass Carousel' },
  { id: 'v3', label: '03 Orbital Loop' },
  { id: 'v4', label: '04 Bento Grid' },
  { id: 'v5', label: '05 Dataflow Nodes' },
  { id: 'v6', label: '06 Deep-Dive Tabs' },
  { id: 'v7', label: '07 3D Stack' },
  { id: 'v8', label: '08 Terminal Story' },
  { id: 'v9', label: '09 QA Comparison' },
  { id: 'v10', label: '10 Drawers' },
  { id: 'v11', label: '11 Simulator' },
];

export function HowItWorksVariantsShowcase() {
  const [activeFilter, setActiveFilter] = useState<string>('all');

  const scrollToVariant = (id: string) => {
    setActiveFilter(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <section className="hiw-showcase-section" aria-label="How It Works Design Variations">
      <div className="hiw-showcase-header">
        <div className="hiw-showcase-kicker">DESIGN EXPLORATION LAB</div>
        <h2>11 Alternative &quot;How It Works&quot; Design Concepts</h2>
        <p className="hiw-showcase-intro">
          Review the 11 different UI/UX design patterns below. All designs are fully responsive, interactive, and aligned with the Agentic Test design system.
        </p>

        {/* Quick Jump Bar */}
        <div className="hiw-jump-bar">
          <button
            type="button"
            className={`hiw-jump-pill ${activeFilter === 'all' ? 'active' : ''}`}
            onClick={() => setActiveFilter('all')}
          >
            Show All 11
          </button>
          {variantsNav.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`hiw-jump-pill ${activeFilter === v.id ? 'active' : ''}`}
              onClick={() => scrollToVariant(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="hiw-showcase-list">
        {(activeFilter === 'all' || activeFilter === 'v1') && (
          <div id="v1" className="hiw-variant-anchor">
            <Variant1InteractiveSplit />
          </div>
        )}

        {(activeFilter === 'all' || activeFilter === 'v2') && (
          <div id="v2" className="hiw-variant-anchor">
            <Variant2GlassCarousel />
          </div>
        )}

        {(activeFilter === 'all' || activeFilter === 'v3') && (
          <div id="v3" className="hiw-variant-anchor">
            <Variant3OrbitalBrain />
          </div>
        )}

        {(activeFilter === 'all' || activeFilter === 'v4') && (
          <div id="v4" className="hiw-variant-anchor">
            <Variant4BentoGrid />
          </div>
        )}

        {(activeFilter === 'all' || activeFilter === 'v5') && (
          <div id="v5" className="hiw-variant-anchor">
            <Variant5PipelineFlow />
          </div>
        )}

        {(activeFilter === 'all' || activeFilter === 'v6') && (
          <div id="v6" className="hiw-variant-anchor">
            <Variant6TabbedDeepDive />
          </div>
        )}

        {(activeFilter === 'all' || activeFilter === 'v7') && (
          <div id="v7" className="hiw-variant-anchor">
            <Variant7IsometricStack />
          </div>
        )}

        {(activeFilter === 'all' || activeFilter === 'v8') && (
          <div id="v8" className="hiw-variant-anchor">
            <Variant8TerminalStoryboard />
          </div>
        )}

        {(activeFilter === 'all' || activeFilter === 'v9') && (
          <div id="v9" className="hiw-variant-anchor">
            <Variant9ComparisonMatrix />
          </div>
        )}

        {(activeFilter === 'all' || activeFilter === 'v10') && (
          <div id="v10" className="hiw-variant-anchor">
            <Variant10AccordionDrawers />
          </div>
        )}

        {(activeFilter === 'all' || activeFilter === 'v11') && (
          <div id="v11" className="hiw-variant-anchor">
            <Variant11ExecutionSimulator />
          </div>
        )}
      </div>
    </section>
  );
}

export default HowItWorksVariantsShowcase;

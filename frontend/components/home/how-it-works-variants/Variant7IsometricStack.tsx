import { useState } from 'react';
import {
  Browsers,
  Cpu,
  ShieldCheck,
  Code,
  ArrowsClockwise,
} from '@phosphor-icons/react';

const isometricLayers = [
  {
    layer: 'LAYER 05',
    title: 'Assertion Preservation & Self-Healing',
    role: 'Healing Layer',
    desc: 'Analyzes mechanical browser errors to revise flaky locators while strictly preserving all original test assertions.',
    icon: ArrowsClockwise,
    badge: '100% Assertion Guard',
    color: '#ea580c',
  },
  {
    layer: 'LAYER 04',
    title: 'Static TypeScript Compilation',
    role: 'Compiler Layer',
    desc: 'Runs ahead-of-time tsc typechecking inside an isolated sandbox to eliminate syntax issues prior to browser launch.',
    icon: ShieldCheck,
    badge: 'Zero Diagnostics',
    color: '#16a34a',
  },
  {
    layer: 'LAYER 03',
    title: 'Playwright Code Synthesis',
    role: 'Synthesis Layer',
    desc: 'Converts grounded test journeys into robust, maintainable Playwright TypeScript scripts using verified crawl locators.',
    icon: Code,
    badge: 'Strict Locators',
    color: '#7c3aed',
  },
  {
    layer: 'LAYER 02',
    title: 'Grounded Journey Planner',
    role: 'Reasoning Layer',
    desc: 'LLM reasoning derives comprehensive user workflows grounded exclusively in verified DOM evidence without hallucination.',
    icon: Cpu,
    badge: 'Zero Hallucinations',
    color: '#0284c7',
  },
  {
    layer: 'LAYER 01',
    title: 'Live Headless DOM Crawler',
    role: 'Perception Layer',
    desc: 'Launches headless Chromium to probe interactive targets, cataloging clickable elements, forms, and ARIA roles.',
    icon: Browsers,
    badge: 'DOM Evidence',
    color: '#527318',
  },
];

export function Variant7IsometricStack() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className="hiw-pattern-wrap">
      <div className="hiw-pattern-header">
        <span className="hiw-pattern-badge">DESIGN PATTERN 07</span>
        <h3>3D Layered Isometric Stack</h3>
        <p>A multi-tiered architectural stack with depth elevation, revealing the decoupled components powering the engine.</p>
      </div>

      <div className="hiw-isometric-container">
        <div className="hiw-isometric-stack">
          {isometricLayers.map((layer, index) => {
            const IconComp = layer.icon;
            const isHovered = hoveredIndex === index;
            // Higher layers stack on top visually
            const zIndex = isometricLayers.length - index;

            return (
              <div
                key={layer.layer}
                className={`hiw-iso-layer ${isHovered ? 'hovered' : ''}`}
                style={{ zIndex }}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <div className="hiw-iso-content">
                  <div className="hiw-iso-meta">
                    <span className="hiw-iso-num">{layer.layer}</span>
                    <span className="hiw-iso-role">{layer.role}</span>
                  </div>

                  <div className="hiw-iso-body">
                    <div className="hiw-iso-icon" style={{ color: layer.color }}>
                      <IconComp className="h-5 w-5" weight="duotone" />
                    </div>
                    <div className="hiw-iso-info">
                      <h4>{layer.title}</h4>
                      <p>{layer.desc}</p>
                    </div>
                    <div className="hiw-iso-badge" style={{ backgroundColor: `${layer.color}15`, color: layer.color }}>
                      {layer.badge}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Variant7IsometricStack;

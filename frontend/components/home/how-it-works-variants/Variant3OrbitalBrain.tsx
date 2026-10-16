import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu,
  Globe,
  Lightbulb,
  TerminalWindow,
  CheckFat,
  Heartbeat,
} from '@phosphor-icons/react';

const orbitNodes = [
  {
    id: 'crawl',
    label: '01 Crawl',
    title: 'DOM Extraction Engine',
    desc: 'Extracts real interactive elements, forms, and hierarchy directly from the running browser.',
    icon: Globe,
    stats: '18 elements cataloged',
    color: '#527318',
  },
  {
    id: 'plan',
    label: '02 Plan',
    title: 'Intent & Journey Reasoner',
    desc: 'Grounds end-to-end user journeys strictly in discovered interactive elements.',
    icon: Lightbulb,
    stats: '5 journeys synthesized',
    color: '#0284c7',
  },
  {
    id: 'codegen',
    label: '03 CodeGen',
    title: 'Playwright TypeScript Synthesis',
    desc: 'Generates type-safe specs with robust locator strategies and proper timeouts.',
    icon: TerminalWindow,
    stats: 'Zero selector guessing',
    color: '#7c3aed',
  },
  {
    id: 'validate',
    label: '04 Validate',
    title: 'Sandboxed Typecheck',
    desc: 'Compiles with tsc --noEmit before browser execution to catch early mechanical issues.',
    icon: CheckFat,
    stats: '0 diagnostics guarantee',
    color: '#16a34a',
  },
  {
    id: 'heal',
    label: '05 Heal',
    title: 'Assertion Preservation Guard',
    desc: 'Heals flaky locators using browser error logs while strictly preserving original test assertions.',
    icon: Heartbeat,
    stats: '100% assertions intact',
    color: '#ea580c',
  },
];

export function Variant3OrbitalBrain() {
  const [selectedNode, setSelectedNode] = useState<string>('codegen');

  const active = orbitNodes.find((n) => n.id === selectedNode) || orbitNodes[2];

  return (
    <div className="hiw-pattern-wrap">
      <div className="hiw-pattern-header">
        <span className="hiw-pattern-badge">DESIGN PATTERN 03</span>
        <h3>Autonomous Agent Orbital Loop</h3>
        <p>A closed-loop autonomous system where each stage orbits a central intelligent coordination brain.</p>
      </div>

      <div className="hiw-orbital-container">
        {/* Orbital Center Core */}
        <div className="hiw-orbital-canvas">
          <div className="hiw-orbit-ring" />
          <div className="hiw-orbit-ring-outer" />

          {/* Central Core Brain */}
          <div className="hiw-orbit-center">
            <div className="hiw-pulse-circle" />
            <div className="hiw-center-badge">
              <Cpu className="h-7 w-7 text-[#17201b]" weight="duotone" />
              <span>AGENTIC CORE</span>
              <small>Autonomous Loop</small>
            </div>
          </div>

          {/* 5 Orbital Nodes in Circle */}
          {orbitNodes.map((node, index) => {
            const angle = (index / orbitNodes.length) * 2 * Math.PI - Math.PI / 2;
            const radius = 170; // px
            const x = Math.round(Math.cos(angle) * radius);
            const y = Math.round(Math.sin(angle) * radius);
            const isSelected = node.id === selectedNode;
            const IconCmp = node.icon;

            return (
              <button
                key={node.id}
                type="button"
                className={`hiw-orbit-node-btn ${isSelected ? 'selected' : ''}`}
                style={{
                  transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                }}
                onClick={() => setSelectedNode(node.id)}
              >
                <div className="hiw-node-circle" style={{ borderColor: isSelected ? node.color : undefined }}>
                  <IconCmp className="h-5 w-5" weight={isSelected ? 'fill' : 'regular'} />
                </div>
                <span className="hiw-node-label">{node.label}</span>
              </button>
            );
          })}
        </div>

        {/* Orbit Detail Panel */}
        <div className="hiw-orbital-detail">
          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className="hiw-orbit-card"
            >
              <div className="hiw-orbit-card-badge" style={{ backgroundColor: `${active.color}15`, color: active.color }}>
                {active.label}
              </div>
              <h4 className="hiw-orbit-card-title">{active.title}</h4>
              <p className="hiw-orbit-card-desc">{active.desc}</p>
              <div className="hiw-orbit-card-stats">
                <strong>{active.stats}</strong>
              </div>
              <div className="hiw-orbit-card-footer">
                <span className="hiw-tag">Closed Loop Pipeline</span>
                <span className="hiw-tag">Self-Governing</span>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default Variant3OrbitalBrain;

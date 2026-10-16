import { useState } from 'react';
import {
  Globe,
  Database,
  Cpu,
  FileTs,
  CheckCircle,
  Browsers,
  ArrowRight,
  ShieldCheck,
} from '@phosphor-icons/react';

interface PipelineNode {
  id: string;
  name: string;
  sub: string;
  input: string;
  output: string;
  latency: string;
  icon: typeof Globe;
}

const pipelineNodes: PipelineNode[] = [
  {
    id: 'target',
    name: 'Target URL',
    sub: 'Live Web App',
    input: 'https://acme-store.app',
    output: 'Raw DOM & Network Headers',
    latency: '< 1.5s',
    icon: Globe,
  },
  {
    id: 'crawler',
    name: 'Playwright Crawler',
    sub: 'DOM Extraction',
    input: 'Live HTML & ARIA Tree',
    output: 'AppMap JSON (Verified Locators)',
    latency: '~ 3.2s',
    icon: Database,
  },
  {
    id: 'synthesizer',
    name: 'LLM Synthesizer',
    sub: 'Grounded Journey Planner',
    input: 'AppMap Elements + Constraints',
    output: 'Playwright TypeScript Test Code',
    latency: '~ 4.8s',
    icon: Cpu,
  },
  {
    id: 'compiler',
    name: 'TypeScript Compiler',
    sub: 'AOT Validation Sandbox',
    input: 'Raw generated .spec.ts files',
    output: 'Typecheck Verdict (0 Errors)',
    latency: '~ 200ms',
    icon: FileTs,
  },
  {
    id: 'runner',
    name: 'Headless Browser',
    sub: 'Isolated Chromium Sandbox',
    input: 'Valid Playwright Specs',
    output: 'Pass/Fail Traces & Error Logs',
    latency: '~ 2.5s',
    icon: Browsers,
  },
  {
    id: 'healer',
    name: 'Self-Correction Guard',
    sub: 'Preserves Test Intent',
    input: 'Failure Logs + Original Code',
    output: 'Healed Suite (.zip + HTML)',
    latency: '~ 1.8s',
    icon: ShieldCheck,
  },
];

export function Variant5PipelineFlow() {
  const [activeNodeId, setActiveNodeId] = useState<string>('synthesizer');

  const activeNode = pipelineNodes.find((n) => n.id === activeNodeId) || pipelineNodes[2];

  return (
    <div className="hiw-pattern-wrap">
      <div className="hiw-pattern-header">
        <span className="hiw-pattern-badge">DESIGN PATTERN 05</span>
        <h3>Node-Based Architecture Dataflow</h3>
        <p>A connected pipeline diagram illustrating data transformation contracts from raw URL to verified test suite.</p>
      </div>

      <div className="hiw-pipeline-outer">
        {/* Nodes Track */}
        <div className="hiw-pipeline-track">
          {pipelineNodes.map((node, i) => {
            const IconComp = node.icon;
            const isSelected = node.id === activeNodeId;
            return (
              <div key={node.id} className="hiw-pipeline-node-wrap">
                <button
                  type="button"
                  className={`hiw-pipeline-node ${isSelected ? 'active-node' : ''}`}
                  onClick={() => setActiveNodeId(node.id)}
                >
                  <div className="hiw-pipeline-node-icon">
                    <IconComp className="h-5 w-5" weight={isSelected ? 'fill' : 'regular'} />
                  </div>
                  <span className="hiw-pipeline-node-name">{node.name}</span>
                  <small className="hiw-pipeline-node-sub">{node.sub}</small>
                </button>
                {i < pipelineNodes.length - 1 && (
                  <div className="hiw-pipeline-connector">
                    <div className="hiw-pulse-dot" />
                    <ArrowRight className="h-3 w-3 text-[#748078]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Node Contract Inspector Box */}
        <div className="hiw-pipeline-inspector">
          <div className="hiw-inspector-top">
            <span className="hiw-inspector-title">TRANSFORMATION CONTRACT: {activeNode.name.toUpperCase()}</span>
            <span className="hiw-inspector-latency">Estimated Latency: <b>{activeNode.latency}</b></span>
          </div>

          <div className="hiw-inspector-grid">
            <div className="hiw-contract-card">
              <span className="hiw-contract-label">INPUT CONTRACT</span>
              <code>{activeNode.input}</code>
            </div>
            <div className="hiw-contract-arrow">→</div>
            <div className="hiw-contract-card highlight">
              <span className="hiw-contract-label">OUTPUT ARTIFACT</span>
              <code>{activeNode.output}</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Variant5PipelineFlow;

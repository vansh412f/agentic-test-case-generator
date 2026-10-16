import { useState, useEffect } from 'react';
import {
  Play,
  ArrowCounterClockwise,
  CheckCircle,
  CircleNotch,
  WarningCircle,
  Lightning,
} from '@phosphor-icons/react';

interface SimStep {
  stage: string;
  label: string;
  detail: string;
  status: 'idle' | 'running' | 'done' | 'warning';
}

export function Variant11ExecutionSimulator() {
  const [isRunning, setIsRunning] = useState(false);
  const [activeStage, setActiveStage] = useState<number>(0);
  const [isCompleted, setIsCompleted] = useState(false);

  const stages: SimStep[] = [
    {
      stage: '01 CRAWL',
      label: 'Headless Browser DOM Crawl',
      detail: 'Probing https://acme-store.app · Discovered 18 clickable elements',
      status: activeStage > 0 ? 'done' : activeStage === 0 && isRunning ? 'running' : 'idle',
    },
    {
      stage: '02 PLAN',
      label: 'Journey Synthesis & Intent Deduction',
      detail: 'Synthesizing 5 user journeys with 88% average confidence score',
      status: activeStage > 1 ? 'done' : activeStage === 1 && isRunning ? 'running' : 'idle',
    },
    {
      stage: '03 CODE',
      label: 'Playwright TypeScript CodeGen',
      detail: 'Writing tests/cart.spec.ts with role-based accessible selectors',
      status: activeStage > 2 ? 'done' : activeStage === 2 && isRunning ? 'running' : 'idle',
    },
    {
      stage: '04 VALIDATE',
      label: 'Static tsc --noEmit Typecheck',
      detail: 'Compilation verified in 120ms with 0 diagnostics',
      status: activeStage > 3 ? 'done' : activeStage === 3 && isRunning ? 'running' : 'idle',
    },
    {
      stage: '05 EXECUTE & HEAL',
      label: 'Headless Execution & Self-Correction',
      detail: 'Locator timeout encountered on attempt #1 → Self-corrected in attempt #2 · Assertions preserved 100%',
      status: isCompleted ? 'done' : activeStage === 4 && isRunning ? 'warning' : 'idle',
    },
  ];

  useEffect(() => {
    if (!isRunning) return;

    if (activeStage < 4) {
      const timer = setTimeout(() => {
        setActiveStage((prev) => prev + 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        setIsRunning(false);
        setIsCompleted(true);
      }, 1400);
      return () => clearTimeout(timer);
    }
  }, [isRunning, activeStage]);

  const handleStartSim = () => {
    setActiveStage(0);
    setIsCompleted(false);
    setIsRunning(true);
  };

  const handleReset = () => {
    setActiveStage(0);
    setIsRunning(false);
    setIsCompleted(false);
  };

  return (
    <div className="hiw-pattern-wrap">
      <div className="hiw-pattern-header">
        <span className="hiw-pattern-badge">DESIGN PATTERN 11</span>
        <h3>Interactive Execution Simulator Sandbox</h3>
        <p>Click &quot;Run Simulation&quot; to test the autonomous agent lifecycle with a live simulated pipeline.</p>
      </div>

      <div className="hiw-simulator-container">
        {/* Simulator Control Bar */}
        <div className="hiw-sim-topbar">
          <div className="hiw-sim-buttons">
            <button
              type="button"
              className="hiw-sim-btn primary"
              onClick={handleStartSim}
              disabled={isRunning}
            >
              {isRunning ? (
                <>
                  <CircleNotch className="h-4 w-4 animate-spin" />
                  <span>Simulating Agent...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" weight="fill" />
                  <span>Run Live Simulation</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="hiw-sim-btn"
              onClick={handleReset}
              disabled={isRunning}
            >
              <ArrowCounterClockwise className="h-4 w-4" />
              <span>Reset</span>
            </button>
          </div>

          <div className="hiw-sim-status-chip">
            <span className={`sim-dot ${isRunning ? 'running' : isCompleted ? 'completed' : 'idle'}`} />
            <span>{isRunning ? 'PIPELINE ACTIVE' : isCompleted ? 'SIMULATION COMPLETE' : 'READY TO SIMULATE'}</span>
          </div>
        </div>

        {/* Live Simulator Stages */}
        <div className="hiw-sim-stages-list">
          {stages.map((stg, i) => (
            <div
              key={stg.stage}
              className={`hiw-sim-stage-row ${stg.status}`}
            >
              <div className="hiw-stage-indicator">
                {stg.status === 'done' ? (
                  <CheckCircle className="h-5 w-5 text-[#527318]" weight="fill" />
                ) : stg.status === 'running' ? (
                  <CircleNotch className="h-5 w-5 text-[#0284c7] animate-spin" />
                ) : stg.status === 'warning' ? (
                  <Lightning className="h-5 w-5 text-[#ea580c]" weight="fill" />
                ) : (
                  <div className="hiw-stage-circle-idle">{i + 1}</div>
                )}
              </div>

              <div className="hiw-stage-content">
                <div className="hiw-stage-header">
                  <span className="hiw-stage-tag">{stg.stage}</span>
                  <h4 className="hiw-stage-label">{stg.label}</h4>
                </div>
                <p className="hiw-stage-detail">{stg.detail}</p>
              </div>

              <div className="hiw-stage-badge-status">
                {stg.status === 'done' && <span className="badge-pass">PASS</span>}
                {stg.status === 'running' && <span className="badge-running">RUNNING</span>}
                {stg.status === 'warning' && <span className="badge-healing">HEALING</span>}
                {stg.status === 'idle' && <span className="badge-queued">QUEUED</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Simulator Success Banner */}
        {isCompleted && (
          <div className="hiw-sim-success-banner">
            <CheckCircle className="h-6 w-6 text-[#527318]" weight="fill" />
            <div>
              <strong>Test suite completed in 4.8s</strong>
              <p>5 test cases generated · 1 locator healed · 100% assertions preserved · Ready for export.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Variant11ExecutionSimulator;

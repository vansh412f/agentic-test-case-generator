import { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  ArrowCounterClockwise,
  SkipForward,
  Terminal,
} from '@phosphor-icons/react';

interface LogEntry {
  step: string;
  time: string;
  type: 'cmd' | 'info' | 'plan' | 'code' | 'compile' | 'exec' | 'heal';
  text: string;
}

const storyboardLogs: LogEntry[] = [
  { step: '01 CRAWL', time: '0.0s', type: 'cmd', text: '$ agent crawl https://acme-store.app --depth=1' },
  { step: '01 CRAWL', time: '1.2s', type: 'info', text: '↳ Chromium launched · Discovered 18 interactive elements · 3 form targets' },
  { step: '02 PLAN', time: '2.5s', type: 'plan', text: '◇ Planned Journey 1: Guest adds product to cart and verifies count' },
  { step: '02 PLAN', time: '3.1s', type: 'plan', text: '◇ Planned Journey 2: Filter products by category and verify grid' },
  { step: '03 CODE', time: '4.4s', type: 'code', text: '⚡ Synthesizing cart.spec.ts with page.getByRole("button", { name: "Add" })' },
  { step: '04 VALIDATE', time: '5.2s', type: 'compile', text: '✓ tsc --noEmit: TypeScript compilation verified in 120ms (0 diagnostics)' },
  { step: '05 EXECUTE', time: '7.0s', type: 'exec', text: '● Executing cart.spec.ts in headless browser...' },
  { step: '05 HEAL', time: '8.4s', type: 'heal', text: '↻ Locator timeout on .cart-btn → Corrected to getByTestId("cart-badge")' },
  { step: '05 PASS', time: '9.2s', type: 'info', text: '✓ PASS: cart.spec.ts (2.1s) · 100% assertions preserved' },
];

export function Variant8TerminalStoryboard() {
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(storyboardLogs.length - 1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  useEffect(() => {
    if (!isPlaying) return;

    const timer = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev < storyboardLogs.length - 1) {
          return prev + 1;
        }
        setIsPlaying(false);
        return prev;
      });
    }, 1100);

    return () => clearInterval(timer);
  }, [isPlaying]);

  const reset = () => {
    setCurrentStepIndex(0);
    setIsPlaying(true);
  };

  const next = () => {
    setCurrentStepIndex((prev) => Math.min(storyboardLogs.length - 1, prev + 1));
  };

  return (
    <div className="hiw-pattern-wrap">
      <div className="hiw-pattern-header">
        <span className="hiw-pattern-badge">DESIGN PATTERN 08</span>
        <h3>Terminal-Driven Storyboard CLI</h3>
        <p>Step through or auto-play the autonomous agent execution log as it occurs inside the production runner.</p>
      </div>

      <div className="hiw-storyboard-outer">
        {/* Storyboard Terminal Controls */}
        <div className="hiw-storyboard-controls">
          <div className="hiw-storyboard-buttons">
            <button
              type="button"
              className="hiw-story-btn primary"
              onClick={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span>{isPlaying ? 'Pause' : 'Auto-Play Story'}</span>
            </button>
            <button
              type="button"
              className="hiw-story-btn"
              onClick={next}
              disabled={currentStepIndex === storyboardLogs.length - 1}
            >
              <SkipForward className="h-4 w-4" />
              <span>Next Step</span>
            </button>
            <button
              type="button"
              className="hiw-story-btn"
              onClick={reset}
            >
              <ArrowCounterClockwise className="h-4 w-4" />
              <span>Restart</span>
            </button>
          </div>

          <span className="hiw-storyboard-step-badge">
            Step {currentStepIndex + 1} of {storyboardLogs.length}
          </span>
        </div>

        {/* Storyboard Terminal Box */}
        <div className="hiw-storyboard-terminal">
          <div className="hiw-terminal-top">
            <div className="hiw-dots">
              <span className="d-red" />
              <span className="d-yellow" />
              <span className="d-green" />
            </div>
            <span>agent-runner — headless-zsh</span>
            <span className="hiw-live-tag"><span className="pulse-green" /> LIVE EMULATION</span>
          </div>

          <div className="hiw-storyboard-body">
            {storyboardLogs.slice(0, currentStepIndex + 1).map((log, i) => (
              <div key={i} className={`hiw-story-log-line ${log.type}`}>
                <span className="hiw-log-time">{log.time}</span>
                <span className="hiw-log-step-tag">{log.step}</span>
                <span className="hiw-log-text">{log.text}</span>
              </div>
            ))}
            {currentStepIndex < storyboardLogs.length - 1 && (
              <div className="hiw-story-log-line cursor-line">
                <span className="hiw-terminal-cursor" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Variant8TerminalStoryboard;

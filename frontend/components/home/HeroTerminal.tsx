import { useEffect, useState } from 'react';

interface TerminalLineDef {
  kind: 'command' | 'info' | 'plan' | 'code' | 'pass' | 'correct';
  content: string;
  speed: number;
  delayAfter: number;
}

const terminalLines: TerminalLineDef[] = [
  { kind: 'command', content: '$ agent crawl https://acme-store.app', speed: 28, delayAfter: 450 },
  { kind: 'info', content: '↳ Discovered 4 pages · 37 interactive elements', speed: 18, delayAfter: 350 },
  { kind: 'plan', content: '◇ Planned: guest adds a product to cart', speed: 18, delayAfter: 350 },
  { kind: 'code', content: "await page.getByRole('button', { name: 'Add' }).click();", speed: 22, delayAfter: 450 },
  { kind: 'pass', content: '✓ PASS  cart.spec.ts  (2.4s)', speed: 18, delayAfter: 350 },
  { kind: 'correct', content: "↻ CORRECTED  locator → getByTestId('cart-count')", speed: 20, delayAfter: 3500 },
];

export function HeroTerminal() {
  const [activeLine, setActiveLine] = useState(0);
  const [charCount, setCharCount] = useState(0);

  // Character-by-character typewriter loop with infinite repeat
  useEffect(() => {
    const currentLine = terminalLines[activeLine];
    if (!currentLine) return;

    let timer: ReturnType<typeof setTimeout>;

    if (charCount < currentLine.content.length) {
      // Type next character
      timer = setTimeout(() => {
        setCharCount((prev) => prev + 1);
      }, currentLine.speed);
    } else {
      // Line finished: wait delayAfter, then advance to next line or loop back to 0
      timer = setTimeout(() => {
        if (activeLine < terminalLines.length - 1) {
          setActiveLine((prev) => prev + 1);
          setCharCount(0);
        } else {
          // All lines completed: restart cycle
          setActiveLine(0);
          setCharCount(0);
        }
      }, currentLine.delayAfter);
    }

    return () => clearTimeout(timer);
  }, [activeLine, charCount]);

  return (
    <div className="relative">
      <span className="sr-only">
        Example session: the agent crawls an app, plans a test, executes it, and corrects a locator failure.
      </span>

      <div aria-hidden="true" className="terminal">
        <div className="terminal-bar">
          <div className="traffic">
            <i />
            <i />
            <i />
          </div>
          <span>agent-session — zsh</span>
          <span className="live">
            <i /> live
          </span>
        </div>

        <div className="terminal-body">
          {terminalLines.map((line, i) => {
            const isFinishedLine = i < activeLine;
            const isCurrentLine = i === activeLine;
            const isVisible = isFinishedLine || isCurrentLine;
            const text = isFinishedLine
              ? line.content
              : isCurrentLine
                ? line.content.slice(0, charCount)
                : '';

            return (
              <div
                className={`terminal-line ${line.kind} ${isVisible ? 'show' : ''}`}
                key={i}
              >
                <span className="line-no">{String(i + 1).padStart(2, '0')}</span>
                <code>{text}</code>
                {isCurrentLine && <span className="cursor" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default HeroTerminal;

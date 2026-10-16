import { useEffect, useRef, useState } from 'react';

const terminalLines = [
  { kind: 'command', content: '$ agent crawl https://acme-store.app', speed: 32, delayAfter: 400 },
  { kind: 'info', content: '↳ Discovered 4 pages · 37 interactive elements', speed: 18, delayAfter: 350 },
  { kind: 'plan', content: '◇ Planned: guest adds a product to cart', speed: 20, delayAfter: 350 },
  { kind: 'code', content: "await page.getByRole('button', { name: 'Add' }).click();", speed: 26, delayAfter: 450 },
  { kind: 'pass', content: '✓ PASS  cart.spec.ts  (2.4s)', speed: 18, delayAfter: 350 },
  { kind: 'correct', content: "↻ CORRECTED  locator → getByTestId('cart-count')", speed: 22, delayAfter: 4000 },
];

export function HeroTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeLine, setActiveLine] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isInView, setIsInView] = useState(true);

  // Check prefers-reduced-motion
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) {
      setReducedMotion(true);
    }
    const handler = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  // Pause on off-screen or hidden tab
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInView(Boolean(entry?.isIntersecting) && document.visibilityState === 'visible');
      },
      { threshold: 0.1 }
    );
    observer.observe(el);

    const handleVisibility = () => {
      setIsInView(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Character-by-character typewriter loop
  useEffect(() => {
    if (reducedMotion || !isInView) return;

    const currentLineData = terminalLines[activeLine];
    if (!currentLineData) return;

    let timer: ReturnType<typeof setTimeout>;

    if (charCount < currentLineData.content.length) {
      // Type next character
      timer = setTimeout(() => {
        setCharCount((prev) => prev + 1);
      }, currentLineData.speed);
    } else {
      // Line is finished: wait delayAfter, then advance to next line or loop
      timer = setTimeout(() => {
        if (activeLine < terminalLines.length - 1) {
          setActiveLine((l) => l + 1);
          setCharCount(0);
        } else {
          // Restart loop
          setActiveLine(0);
          setCharCount(0);
        }
      }, currentLineData.delayAfter);
    }

    return () => clearTimeout(timer);
  }, [activeLine, charCount, reducedMotion, isInView]);

  return (
    <div className="relative" ref={containerRef}>
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
            const isVisible = reducedMotion || isFinishedLine || isCurrentLine;
            const text = reducedMotion || isFinishedLine
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
                {isCurrentLine && !reducedMotion && <span className="cursor" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default HeroTerminal;

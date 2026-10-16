import { useEffect, useRef, useState } from 'react';

const terminalLines = [
  { kind: 'command', content: '$ agent crawl https://acme-store.app' },
  { kind: 'info', content: '↳ Discovered 4 pages · 37 interactive elements' },
  { kind: 'plan', content: '◇ Planned: guest adds a product to cart' },
  { kind: 'code', content: "await page.getByRole('button', { name: 'Add' }).click();" },
  { kind: 'pass', content: '✓ PASS  cart.spec.ts  (2.4s)' },
  { kind: 'correct', content: "↻ CORRECTED  locator → getByTestId('cart-count')" },
];

export function HeroTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(1);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isInView, setIsInView] = useState(true);

  // Check prefers-reduced-motion
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) {
      setReducedMotion(true);
      setVisible(terminalLines.length);
    }
    const handler = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
      if (e.matches) {
        setVisible(terminalLines.length);
      }
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

  // 1s-step reveal loop with hold
  useEffect(() => {
    if (reducedMotion || !isInView) return;

    let timer: ReturnType<typeof setTimeout>;

    if (visible < terminalLines.length) {
      // Step to next line every 1000ms
      timer = setTimeout(() => {
        setVisible((v) => v + 1);
      }, 1000);
    } else {
      // Hold complete frame for 4s, then restart
      timer = setTimeout(() => {
        setVisible(1);
      }, 4000);
    }

    return () => clearTimeout(timer);
  }, [visible, reducedMotion, isInView]);

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
          {terminalLines.map((line, i) => (
            <div
              className={`terminal-line ${line.kind} ${i < visible ? 'show' : ''}`}
              key={i}
            >
              <span className="line-no">{String(i + 1).padStart(2, '0')}</span>
              <code>{line.content}</code>
              {i === visible - 1 && !reducedMotion && <span className="cursor" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default HeroTerminal;

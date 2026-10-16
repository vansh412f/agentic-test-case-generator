import { useEffect, useRef, useState } from 'react';

const COMMAND = '$ crawl https://todo-app-staging.vercel.app';

export function HeroTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [typedChars, setTypedChars] = useState(0);
  const [step, setStep] = useState(0); // 0 = typing command, 1 = appMap, 2 = tc1, 3 = pass, 4 = corrected, 5 = hold
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // Check prefers-reduced-motion on mount
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) {
      setReducedMotion(true);
      setStep(5);
      setTypedChars(COMMAND.length);
    }
    const handler = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
      if (e.matches) {
        setStep(5);
        setTypedChars(COMMAND.length);
      }
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  // Pause on off-screen or tab visibility change
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(Boolean(entry?.isIntersecting) && document.visibilityState === 'visible');
      },
      { threshold: 0.1 }
    );
    observer.observe(el);

    const handleVisibility = () => {
      setIsVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Animation sequence loop
  useEffect(() => {
    if (reducedMotion || !isVisible) return;

    let timer: ReturnType<typeof setTimeout>;

    if (step === 0) {
      // Type command character-by-character
      if (typedChars < COMMAND.length) {
        timer = setTimeout(() => {
          setTypedChars((c) => c + 1);
        }, 42);
      } else {
        // Command finished, transition to step 1
        timer = setTimeout(() => {
          setStep(1);
        }, 450);
      }
    } else if (step === 1) {
      // App map line
      timer = setTimeout(() => {
        setStep(2);
      }, 500);
    } else if (step === 2) {
      // tc-1 and locator line
      timer = setTimeout(() => {
        setStep(3);
      }, 550);
    } else if (step === 3) {
      // PASS line
      timer = setTimeout(() => {
        setStep(4);
      }, 500);
    } else if (step === 4) {
      // CORRECTED line
      timer = setTimeout(() => {
        setStep(5);
      }, 600);
    } else if (step === 5) {
      // Hold complete frame for 4s, then restart loop
      timer = setTimeout(() => {
        setTypedChars(0);
        setStep(0);
      }, 4000);
    }

    return () => clearTimeout(timer);
  }, [step, typedChars, reducedMotion, isVisible]);

  return (
    <aside
      aria-label="Example agent session"
      className="panel overflow-hidden font-mono text-small"
      ref={containerRef}
    >
      <span className="sr-only">
        Example session: the agent crawls an app, plans a test, executes it, and corrects a locator failure.
      </span>

      {/* macOS window header */}
      <div className="flex items-center justify-between border-b px-4 py-3 bg-muted/40">
        <div className="flex items-center gap-2">
          <div aria-hidden="true" className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#FF5F57] inline-block shadow-sm" />
            <span className="h-3 w-3 rounded-full bg-[#FEBC2E] inline-block shadow-sm" />
            <span className="h-3 w-3 rounded-full bg-[#28C840] inline-block shadow-sm" />
          </div>
          <span className="ml-2 font-mono text-caption text-muted-foreground select-none">
            agent.session — zsh
          </span>
        </div>

        <div className="flex items-center gap-2 text-success font-mono text-caption">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full bg-current ${reducedMotion ? '' : 'animate-blink'}`}
          />
          <span>ready</span>
        </div>
      </div>

      {/* Terminal body with stable minimum height */}
      <div
        aria-hidden="true"
        className="space-y-4 p-5 leading-relaxed min-h-[300px] flex flex-col justify-start"
      >
        <p>
          <span className="text-muted-foreground">
            {COMMAND.slice(0, Math.min(typedChars, 7))}
          </span>
          {typedChars > 7 ? COMMAND.slice(7, typedChars) : ''}
          {step === 0 && (
            <span
              className={`inline-block w-2 h-4 ml-0.5 align-middle bg-foreground/80 ${
                reducedMotion ? '' : 'animate-blink'
              }`}
            />
          )}
        </p>

        {step >= 1 && (
          <p className="text-success animate-in fade-in duration-200">
            App Map: 18 elements · 1 form · 3 internal pages
          </p>
        )}

        {step >= 2 && (
          <div className="space-y-1 animate-in fade-in duration-200">
            <p>
              <span className="text-info font-semibold">tc-1</span> Add new todo item
            </p>
            <p className="break-all text-muted-foreground">
              page.getByPlaceholder(&apos;What needs to be done?&apos;)
            </p>
          </div>
        )}

        {step >= 3 && (
          <p className="animate-in fade-in duration-200">
            <span className="text-success font-semibold">PASS</span> validate · execute
          </p>
        )}

        {step >= 4 && (
          <p className="animate-in fade-in duration-200">
            <span className="text-warning font-semibold">CORRECTED</span> locator timeout on
            getByTestId(&apos;submit-btn&apos;)
          </p>
        )}
      </div>
    </aside>
  );
}

export default HeroTerminal;

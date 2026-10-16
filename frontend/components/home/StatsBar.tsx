import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Globe, FileCode, CheckCircle, ArrowCounterClockwise } from '@phosphor-icons/react';
import { fetcher, apiBase } from '@/lib/api';

export interface LifetimeStats {
  jobsRun: number;
  testCasesGenerated: number;
  testsPassed: number;
  correctionsApplied: number;
  updatedAt: string;
}

function AnimatedNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setDisplayValue(value);
      return;
    }

    const duration = 900;
    const start = performance.now();
    let frameId: number;

    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      // easeOutExpo
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplayValue(Math.round(ease * value));

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [inView, value]);

  return <span ref={ref}>{displayValue.toLocaleString()}</span>;
}

export function StatsBar() {
  const { data } = useSWR<LifetimeStats>(`${apiBase()}/api/stats`, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });

  if (!data) return null;

  const total =
    data.jobsRun +
    data.testCasesGenerated +
    data.testsPassed +
    data.correctionsApplied;

  // Fresh empty DB renders nothing (no vanity strip with all zeros)
  if (total === 0) return null;

  const stats = [
    {
      label: 'URLs Crawled',
      value: data.jobsRun,
      icon: Globe,
      color: 'text-info',
    },
    {
      label: 'Test Cases Generated',
      value: data.testCasesGenerated,
      icon: FileCode,
      color: 'text-brand',
    },
    {
      label: 'Tests Passed E2E',
      value: data.testsPassed,
      icon: CheckCircle,
      color: 'text-success',
    },
    {
      label: 'Self-Corrections Applied',
      value: data.correctionsApplied,
      icon: ArrowCounterClockwise,
      color: 'text-warning',
    },
  ];

  return (
    <div className="panel my-8 p-5 sm:p-6 border bg-surface-elevated/40">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Icon aria-hidden="true" className={`h-4 w-4 ${color}`} />
              <span className="font-mono text-caption text-muted-foreground">{label}</span>
            </div>
            <p className="font-mono text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              <AnimatedNumber value={value} />
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default StatsBar;

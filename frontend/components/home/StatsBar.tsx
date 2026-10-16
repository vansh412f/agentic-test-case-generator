import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { motion } from 'framer-motion';
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

  return (
    <motion.div
      className="stats-strip"
      initial={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      viewport={{ once: true, margin: '-80px' }}
      whileInView={{ opacity: 1, y: 0 }}
    >
      <div>
        <strong>
          <AnimatedNumber value={data.jobsRun} />
        </strong>
        <span>jobs run</span>
      </div>
      <div>
        <strong>
          <AnimatedNumber value={data.testCasesGenerated} />
        </strong>
        <span>test cases</span>
      </div>
      <div>
        <strong>
          <AnimatedNumber value={data.testsPassed} />
        </strong>
        <span>tests passed</span>
      </div>
      <div>
        <strong>
          <AnimatedNumber value={data.correctionsApplied} />
        </strong>
        <span>auto-corrections</span>
      </div>
    </motion.div>
  );
}

export default StatsBar;

import { cn } from '@/lib/utils';
import type { JobStatus, StepStatus, TestFinalStatus } from '@/types/api';

type StatusValue = JobStatus | TestFinalStatus | StepStatus | string;

const toneByStatus: Record<string, string> = {
  completed: 'border-success/40 bg-success/10 text-success',
  passed: 'border-success/40 bg-success/10 text-success',
  success: 'border-success/40 bg-success/10 text-success',
  failed: 'border-danger/40 bg-danger/10 text-danger',
  failure: 'border-danger/40 bg-danger/10 text-danger',
  gave_up: 'border-warning/40 bg-warning/10 text-warning',
  pending: 'border-border bg-muted text-muted-foreground',
  crawling: 'border-info/40 bg-info/10 text-info',
  planning: 'border-info/40 bg-info/10 text-info',
  generating: 'border-brand/40 bg-brand/10 text-brand-strong dark:text-brand',
  executing: 'border-brand/40 bg-brand/10 text-brand-strong dark:text-brand',
};

interface StatusBadgeProps {
  status: StatusValue;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const tone = toneByStatus[status] ?? 'border-border bg-muted text-muted-foreground';

  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center gap-2 rounded-full border px-2.5 py-0.5 font-mono text-caption font-semibold uppercase tracking-wide',
        tone,
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {status.replace('_', ' ')}
    </span>
  );
}

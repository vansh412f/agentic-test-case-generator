import { cn } from '@/lib/utils';
import type { JobStatus, StepStatus, TestFinalStatus } from '@/types/api';

type StatusValue = JobStatus | TestFinalStatus | StepStatus | string;

interface StatusBadgeProps {
  status: StatusValue;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = String(status).toLowerCase();
  const isDone = normalized === 'completed' || normalized === 'passed' || normalized === 'success';
  const isFail = normalized === 'failed' || normalized.includes('fail') || normalized === 'failure';
  const isCancelled = normalized === 'cancelled';
  const isGaveUp = normalized === 'gave_up' || normalized === 'gave up';
  const badgeClass = isDone
    ? 'badge-green'
    : isFail
      ? 'badge-red'
      : isCancelled
        ? 'badge-grey'
        : isGaveUp
          ? 'badge-amber'
          : 'badge-blue';

  return (
    <span className={cn('badge', badgeClass, className)}>
      <i aria-hidden="true" className="badge-dot" />
      {isCancelled ? 'Cancelled' : normalized.replace(/[-_]/g, ' ')}
    </span>
  );
}

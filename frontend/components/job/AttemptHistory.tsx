import { CaretDown, Wrench } from '@phosphor-icons/react';
import { useState } from 'react';
import { DiffViewer } from '@/components/code/DiffViewer';
import { StatusBadge } from '@/components/common/StatusBadge';
import { cn, formatDurationMs } from '@/lib/utils';
import type { ExecutionResult } from '@/types/api';

interface AttemptHistoryProps {
  attempts: ExecutionResult[];
}

function validationErrorText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export function AttemptHistory({ attempts }: AttemptHistoryProps) {
  const [expandedAttempt, setExpandedAttempt] = useState<number | null>(null);
  const sorted = [...attempts].sort(
    (a, b) => a.attemptNumber - b.attemptNumber,
  );

  if (sorted.length === 0) {
    return (
      <p className="rounded-panel border border-dashed p-4 text-small text-muted-foreground">
        No execution attempts were persisted for this test.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((attempt, index) => {
        const expanded = expandedAttempt === attempt.attemptNumber;
        const previous = index > 0 ? sorted[index - 1] : undefined;
        const validationErrors = validationErrorText(attempt.validationErrors);

        return (
          <article className="rounded-panel border bg-background" key={attempt.id}>
            <button
              aria-expanded={expanded}
              className="flex min-h-12 w-full items-center justify-between gap-4 rounded-panel px-4 py-3 text-left transition-colors hover:bg-muted/60"
              onClick={() =>
                setExpandedAttempt(expanded ? null : attempt.attemptNumber)
              }
              type="button"
            >
              <span className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-small font-bold">
                  Attempt {attempt.attemptNumber}
                </span>
                {attempt.corrected ? (
                  <span className="inline-flex items-center gap-1 font-mono text-caption text-warning">
                    <Wrench aria-hidden="true" className="h-3.5 w-3.5" />
                    corrected
                  </span>
                ) : null}
              </span>

              <CaretDown
                aria-hidden="true"
                className={cn('h-5 w-5 transition-transform', expanded && 'rotate-180')}
              />
            </button>

            {expanded ? (
              <div className="space-y-4 border-t p-4">
                <dl className="grid gap-3 text-small sm:grid-cols-2">
                  <div>
                    <dt className="text-caption uppercase tracking-wide text-muted-foreground">
                      Static validation
                    </dt>
                    <dd className="mt-1">
                      <StatusBadge status={attempt.validationPassed ? 'passed' : 'failed'} />
                    </dd>
                  </div>

                  <div>
                    <dt className="text-caption uppercase tracking-wide text-muted-foreground">
                      Browser execution
                    </dt>
                    <dd className="mt-1">
                      {attempt.executionPassed === null ? (
                        <span className="text-muted-foreground">Not executed</span>
                      ) : (
                        <StatusBadge status={attempt.executionPassed ? 'passed' : 'failed'} />
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-caption uppercase tracking-wide text-muted-foreground">
                      Failure class
                    </dt>
                    <dd className="mt-1 font-mono">
                      {attempt.failureClass ?? '—'}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-caption uppercase tracking-wide text-muted-foreground">
                      Browser duration
                    </dt>
                    <dd className="mt-1 font-mono">
                      {formatDurationMs(attempt.durationMs)}
                    </dd>
                  </div>
                </dl>

                {validationErrors ? (
                  <div>
                    <h4 className="text-small font-semibold">Validation errors</h4>
                    <pre className="mt-2 overflow-auto rounded-panel border p-4 font-mono text-caption leading-relaxed">
                      {validationErrors}
                    </pre>
                  </div>
                ) : null}

                {attempt.executionError ? (
                  <div>
                    <h4 className="text-small font-semibold">Execution error</h4>
                    <pre className="mt-2 overflow-auto rounded-panel border border-danger/30 p-4 font-mono text-caption leading-relaxed">
                      {attempt.executionError}
                    </pre>
                  </div>
                ) : null}

                {previous !== undefined && previous.code !== attempt.code ? (
                  <div>
                    <h4 className="text-small font-semibold">
                      Correction diff: attempt {previous.attemptNumber} → {attempt.attemptNumber}
                    </h4>
                    <div className="mt-2">
                      <DiffViewer modified={attempt.code} original={previous.code} />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

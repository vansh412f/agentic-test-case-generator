import { CodeViewer } from '@/components/code/CodeViewer';
import { StatusBadge } from '@/components/common/StatusBadge';
import type { PersistedGeneratedTest, PlannedTestCase } from '@/types/api';
import { AttemptHistory } from './AttemptHistory';
import { ConfidenceMeter } from './ConfidenceMeter';

interface TestResultCardProps {
  test: PersistedGeneratedTest;
  plannedCase?: PlannedTestCase;
}

export function TestResultCard({ test, plannedCase }: TestResultCardProps) {
  return (
    <article className="panel p-5 sm:p-6">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-caption uppercase tracking-widest text-muted-foreground">
            {test.testCaseId}
          </p>
          <h3 className="mt-2 text-heading-2 font-bold">
            {plannedCase?.title ?? test.filename}
          </h3>
          {plannedCase ? (
            <p className="mt-2 max-w-reading text-small text-muted-foreground">
              {plannedCase.description}
            </p>
          ) : null}
        </div>

        <StatusBadge status={test.finalStatus} />
      </div>

      <div className="grid gap-5 py-5 md:grid-cols-2">
        <div>
          <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            Attempts
          </p>
          <p className="mt-1 font-mono text-heading-2 font-bold">
            {test.totalAttempts}
          </p>
          <p className="mt-1 font-mono text-caption text-muted-foreground">
            {test.filename}
          </p>
        </div>

        <ConfidenceMeter confidence={test.confidence} />
      </div>

      <CodeViewer code={test.finalCode} filename={test.filename} />

      <div className="mt-6">
        <h4 className="mb-3 text-card-title font-semibold">Attempt history</h4>
        <AttemptHistory attempts={test.executionResults} />
      </div>
    </article>
  );
}

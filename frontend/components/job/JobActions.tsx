import { DownloadSimple, FileText } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { isTerminalJobStatus } from '@/lib/utils';
import type { JobDetail } from '@/types/api';

interface JobActionsProps {
  job: JobDetail;
}

export function JobActions({ job }: JobActionsProps) {
  const reportReady = isTerminalJobStatus(job.status);
  const exportReady = job.generatedTests.length > 0;

  return (
    <div className="space-y-3">
      <Button
        asChild={reportReady}
        className="w-full"
        disabled={!reportReady}
        size="lg"
      >
        {reportReady ? (
          <a href={`/api/jobs/${job.id}/report.html`} rel="noreferrer" target="_blank">
            <FileText aria-hidden="true" />
            Download HTML Report
          </a>
        ) : (
          <span>
            <FileText aria-hidden="true" />
            Report Available When Complete
          </span>
        )}
      </Button>

      <Button
        asChild={exportReady}
        className="w-full"
        disabled={!exportReady}
        size="lg"
        variant="outline"
      >
        {exportReady ? (
          <a download href={`/api/jobs/${job.id}/export.zip`}>
            <DownloadSimple aria-hidden="true" />
            Export Test Project
          </a>
        ) : (
          <span>
            <DownloadSimple aria-hidden="true" />
            Export Available After Generation
          </span>
        )}
      </Button>

      {!reportReady ? (
        <p className="text-caption text-muted-foreground">
          The report unlocks when the job reaches a completed or failed state.
        </p>
      ) : null}
    </div>
  );
}

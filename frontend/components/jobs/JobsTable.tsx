import { Download, ExternalLink, FileText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { StatusBadge } from '@/components/common/StatusBadge';
import {
  formatDateTime,
  formatJobDuration,
  isTerminalJobStatus,
} from '@/lib/utils';
import type { JobSummary } from '@/types/api';

interface JobsTableProps {
  jobs: JobSummary[];
}

function JobMetrics({ job }: { job: JobSummary }) {
  return (
    <p className="font-mono text-caption text-muted-foreground">
      {job.testCount} tests · {job.passedCount} passed · {job.failedCount} findings ·{' '}
      {job.gaveUpCount} gave up
    </p>
  );
}

export function JobsTable({ jobs }: JobsTableProps) {
  const router = useRouter();

  return (
    <>
      <div className="panel hidden overflow-hidden md:block">
        <table className="w-full text-left text-small">
          <thead className="border-b bg-muted/40 font-mono text-caption uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-4 font-medium" scope="col">Target</th>
              <th className="px-5 py-4 font-medium" scope="col">Status</th>
              <th className="px-5 py-4 font-medium" scope="col">Results</th>
              <th className="px-5 py-4 font-medium" scope="col">Created</th>
              <th className="px-5 py-4 font-medium" scope="col">Duration</th>
              <th className="px-5 py-4 font-medium" scope="col">Downloads</th>
            </tr>
          </thead>

          <tbody className="divide-y">
            {jobs.map((job) => (
              <tr
                className="cursor-pointer transition-colors hover:bg-muted/50"
                key={job.id}
                onClick={() => void router.push(`/jobs/${job.id}`)}
              >
                <td className="max-w-80 px-5 py-4">
                  <Link
                    className="block break-all rounded-control font-mono font-semibold hover:underline"
                    href={`/jobs/${job.id}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {job.targetUrl}
                  </Link>
                  <p className="mt-1 truncate font-mono text-caption text-muted-foreground">
                    {job.id}
                  </p>
                </td>

                <td className="px-5 py-4">
                  <StatusBadge status={job.status} />
                </td>

                <td className="px-5 py-4">
                  <JobMetrics job={job} />
                </td>

                <td className="whitespace-nowrap px-5 py-4 font-mono text-caption">
                  {formatDateTime(job.createdAt)}
                </td>

                <td className="whitespace-nowrap px-5 py-4 font-mono text-caption">
                  {formatJobDuration(job.createdAt, job.completedAt)}
                </td>

                <td className="px-5 py-4">
                  <div className="flex gap-2">
                    {isTerminalJobStatus(job.status) ? (
                      <a
                        aria-label={`Open HTML report for ${job.targetUrl}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-control border transition-colors hover:bg-muted"
                        href={`/api/jobs/${job.id}/report.html`}
                        onClick={(event) => event.stopPropagation()}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <FileText aria-hidden="true" className="h-4 w-4" />
                      </a>
                    ) : null}

                    {job.testCount > 0 ? (
                      <a
                        aria-label={`Download test project for ${job.targetUrl}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-control border transition-colors hover:bg-muted"
                        download
                        href={`/api/jobs/${job.id}/export.zip`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Download aria-hidden="true" className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-4 md:hidden">
        {jobs.map((job) => (
          <article className="panel p-5" key={job.id}>
            <div className="flex items-start justify-between gap-3">
              <p className="break-all font-mono text-small font-bold">{job.targetUrl}</p>
              <StatusBadge status={job.status} />
            </div>

            <div className="mt-4">
              <JobMetrics job={job} />
              <p className="mt-2 font-mono text-caption text-muted-foreground">
                {formatDateTime(job.createdAt)}
              </p>
            </div>

            <Link
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-control border px-4 font-semibold"
              href={`/jobs/${job.id}`}
            >
              Open Job Details
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}

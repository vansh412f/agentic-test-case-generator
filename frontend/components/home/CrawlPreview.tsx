import {
  AlertTriangle,
  CheckCircle2,
  FileInput,
  Link2,
  MousePointerClick,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AppMap } from '@/types/api';

interface CrawlPreviewProps {
  appMap: AppMap;
  selectedUrls: string[];
  generating: boolean;
  onToggleUrl: (url: string) => void;
  onGenerate: () => void;
  onReset: () => void;
}

export function CrawlPreview({
  appMap,
  selectedUrls,
  generating,
  onToggleUrl,
  onGenerate,
  onReset,
}: CrawlPreviewProps) {
  const pageCount = selectedUrls.length;
  const maxReached = pageCount >= 5;

  return (
    <section aria-labelledby="crawl-preview-title" className="panel overflow-hidden">
      <div className="border-b p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-caption uppercase tracking-widest text-brand-strong dark:text-brand">
              App Map ready
            </p>
            <h2 className="mt-2 truncate text-heading-2 font-bold" id="crawl-preview-title">
              {appMap.title || appMap.url}
            </h2>
            <p className="mt-1 break-all font-mono text-small text-muted-foreground">
              {appMap.url}
            </p>
          </div>

          <Button
            disabled={generating || selectedUrls.length === 0}
            onClick={onGenerate}
            size="lg"
            type="button"
          >
            <Play aria-hidden="true" />
            {generating
              ? 'Generating Test Suite…'
              : `Generate Tests for ${pageCount} Page${pageCount === 1 ? '' : 's'}`}
          </Button>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-panel border bg-background p-4">
            <dt className="flex items-center gap-2 text-caption uppercase tracking-wide text-muted-foreground">
              <MousePointerClick aria-hidden="true" className="h-4 w-4" />
              Interactive elements
            </dt>
            <dd className="mt-2 font-mono text-heading-2 font-bold">
              {appMap.elements.length}
              <span className="ml-2 text-small font-normal text-muted-foreground">
                / {appMap.totalElementsFound} found
              </span>
            </dd>
          </div>

          <div className="rounded-panel border bg-background p-4">
            <dt className="flex items-center gap-2 text-caption uppercase tracking-wide text-muted-foreground">
              <FileInput aria-hidden="true" className="h-4 w-4" />
              Forms detected
            </dt>
            <dd className="mt-2 font-mono text-heading-2 font-bold">
              {appMap.forms.length}
            </dd>
          </div>

          <div className="rounded-panel border bg-background p-4">
            <dt className="flex items-center gap-2 text-caption uppercase tracking-wide text-muted-foreground">
              <Link2 aria-hidden="true" className="h-4 w-4" />
              Internal pages found
            </dt>
            <dd className="mt-2 font-mono text-heading-2 font-bold">
              {appMap.discoveredLinks.length}
            </dd>
          </div>
        </dl>

        {appMap.isTruncated ? (
          <p className="mt-4 flex gap-2 rounded-panel border border-warning/40 bg-warning/10 p-4 text-small text-warning">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            The element cap was reached. Tests will be generated from the
            highest-priority visible elements retained in this App Map.
          </p>
        ) : null}
      </div>

      <fieldset className="p-5 sm:p-6">
        <legend className="text-card-title font-semibold">
          Select pages to test
        </legend>
        <p className="mt-1 text-small text-muted-foreground">
          The crawled page is always included. Select up to four additional
          discovered pages. Multiple pages run as separate focused jobs.
        </p>

        <div className="mt-5 space-y-3">
          <label className="flex min-h-12 cursor-not-allowed items-center gap-3 rounded-panel border bg-muted/50 p-4">
            <input
              checked
              className="h-4 w-4 accent-current"
              disabled
              type="checkbox"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-small">{appMap.url}</span>
              <span className="text-caption text-muted-foreground">
                Main crawled page
              </span>
            </span>
            <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-success" />
          </label>

          {appMap.discoveredLinks.length === 0 ? (
            <p className="rounded-panel border border-dashed p-4 text-small text-muted-foreground">
              No additional internal pages were discovered on this page. The
              suite will be generated for the main page only.
            </p>
          ) : (
            appMap.discoveredLinks.map((url) => {
              const checked = selectedUrls.includes(url);
              const disabled = generating || (!checked && maxReached);

              return (
                <label
                  className={cn(
                    'flex min-h-12 items-center gap-3 rounded-panel border p-4 transition-colors',
                    disabled
                      ? 'cursor-not-allowed opacity-50'
                      : 'cursor-pointer hover:bg-muted/60',
                  )}
                  key={url}
                >
                  <input
                    checked={checked}
                    className="h-4 w-4 shrink-0"
                    disabled={disabled}
                    onChange={() => onToggleUrl(url)}
                    type="checkbox"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-small">
                    {url}
                  </span>
                </label>
              );
            })
          )}
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite" className="font-mono text-caption text-muted-foreground">
            {pageCount} of 5 pages selected
            {maxReached ? ' — batch limit reached' : ''}
          </p>

          <Button
            disabled={generating}
            onClick={onReset}
            type="button"
            variant="outline"
          >
            Crawl a Different URL
          </Button>
        </div>
      </fieldset>
    </section>
  );
}

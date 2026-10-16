import Link from 'next/link';
import { Warning, Key, Clock, ArrowRight, X, Terminal } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';

interface QuotaExhaustedPanelProps {
  limit?: number;
  resetsAt?: string;
  onDismiss?: () => void;
  onOpenKeys?: () => void;
}

export function QuotaExhaustedPanel({
  limit = 20,
  resetsAt,
  onDismiss,
  onOpenKeys,
}: QuotaExhaustedPanelProps) {
  const formattedReset = resetsAt
    ? `${new Date(resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} UTC (${new Date(resetsAt).toUTCString()})`
    : 'Midnight UTC';

  const handleOpenByok = () => {
    if (onOpenKeys) {
      onOpenKeys();
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-byok-modal'));
    }
  };

  return (
    <div
      aria-labelledby="quota-panel-title"
      className="panel mb-8 border-warning/40 bg-warning/5 p-6 animate-in fade-in duration-200"
      role="region"
    >
      <div className="flex items-start justify-between gap-4 border-b border-warning/20 pb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-warning/20 p-2 text-warning shrink-0">
            <Warning aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-card-title font-semibold text-foreground" id="quota-panel-title">
              Daily Demo Quota Reached
            </h2>
            <p className="mt-1 text-small text-muted-foreground">
              The public demo has reached its daily allocation of {limit} test suite generation runs.
            </p>
          </div>
        </div>

        {onDismiss ? (
          <button
            aria-label="Dismiss quota notice"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onDismiss}
            type="button"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-control border border-border bg-surface-elevated/40 p-4">
          <div className="flex items-center gap-2 text-small font-medium text-foreground">
            <Clock aria-hidden="true" className="h-4 w-4 text-warning" />
            Quota Resets Daily
          </div>
          <p className="mt-2 font-mono text-caption text-muted-foreground">
            Next reset at: <span className="text-foreground">{formattedReset}</span>.
            The demo resets automatically at midnight UTC every day.
          </p>
        </div>

        <div className="rounded-control border border-brand/30 bg-brand/5 p-4">
          <div className="flex items-center gap-2 text-small font-medium text-foreground">
            <Key aria-hidden="true" className="h-4 w-4 text-brand" />
            Bypass with Your Free API Key (BYOK)
          </div>
          <p className="mt-2 text-caption text-muted-foreground">
            Add your own free Groq or Gemini API key. BYOK runs use your personal free-tier quota and bypass the public demo limit.
          </p>
          <div className="mt-3">
            <Button
              className="gap-2 text-caption h-9"
              onClick={handleOpenByok}
              size="sm"
              type="button"
            >
              <Key aria-hidden="true" className="h-3.5 w-3.5" />
              Add Free Groq / Gemini Key
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 pt-3 border-t border-border/50 sm:flex-row sm:items-center sm:justify-between text-caption text-muted-foreground">
        <div className="flex items-center gap-2">
          <Terminal aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          <span>Testing locally? Run the backend with <code className="font-mono text-foreground">pnpm dev</code> or use Cloudflare Tunnel.</span>
        </div>
        <Link
          className="inline-flex items-center gap-1 font-semibold text-foreground underline hover:text-brand"
          href="/jobs"
        >
          Browse past test runs in History
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

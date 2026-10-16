import { useState } from 'react';
import {
  Terminal,
  Copy,
  Check,
  Warning,
  Link as LinkIcon,
  Cpu,
  ArrowSquareOut,
  X,
  CircleNotch,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { classifyTarget, extractTargetPort } from '@/lib/targetUrl';
import { setApiMode, getApiMode } from '@/lib/api';

interface LocalTargetPanelProps {
  targetUrl: string;
  onTunnelUrlAccepted: (url: string) => void;
  onDismiss?: () => void;
  onModeChanged?: () => void;
}

export function LocalTargetPanel({
  targetUrl,
  onTunnelUrlAccepted,
  onDismiss,
  onModeChanged,
}: LocalTargetPanelProps) {
  const [tunnelInput, setTunnelInput] = useState('');
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [copiedRun, setCopiedRun] = useState(false);
  const [connectingLocal, setConnectingLocal] = useState(false);
  const [localAgentNotice, setLocalAgentNotice] = useState<string | null>(null);

  const port = extractTargetPort(targetUrl, 3000);
  const installCmd = 'winget install --id Cloudflare.cloudflared';
  const runCmd = `cloudflared tunnel --url http://localhost:${port}`;

  const currentMode = getApiMode();

  async function copyToClipboard(text: string, type: 'install' | 'run') {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'install') {
        setCopiedInstall(true);
        setTimeout(() => setCopiedInstall(false), 2000);
      } else {
        setCopiedRun(true);
        setTimeout(() => setCopiedRun(false), 2000);
      }
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }

  function handleTunnelSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTunnelError(null);

    if (!tunnelInput.trim()) {
      setTunnelError('Please enter a tunnel URL.');
      return;
    }

    const classified = classifyTarget(tunnelInput.trim());

    if (classified.kind === 'loopback' || classified.kind === 'private') {
      setTunnelError('A tunnel URL cannot itself be a local address.');
      return;
    }

    if (classified.kind === 'invalid' || !classified.normalized) {
      setTunnelError('Invalid URL. Enter a valid public HTTPS tunnel URL.');
      return;
    }

    toast.success('Tunnel URL accepted. Starting crawl...');
    onTunnelUrlAccepted(classified.normalized);
  }

  async function handleConnectLocalAgent() {
    setConnectingLocal(true);
    setLocalAgentNotice(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch('http://localhost:4000/api/health', {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        setApiMode('local-agent');
        toast.success('Connected to Local Agent on http://localhost:4000');
        onModeChanged?.();
        onDismiss?.();
      } else {
        setLocalAgentNotice('Local backend returned an error. Ensure LOCAL_AGENT_MODE=true is configured.');
      }
    } catch {
      clearTimeout(timeoutId);
      setLocalAgentNotice(
        'Could not reach local agent at http://localhost:4000. Ensure it is running (`pnpm dev`) with LOCAL_AGENT_MODE=true, or use Cloudflare Tunnel above.',
      );
    } finally {
      setConnectingLocal(false);
    }
  }

  return (
    <div className="panel mb-8 border-warning/40 bg-warning/5 p-6 animate-in fade-in duration-200">
      <div className="flex items-start justify-between gap-4 border-b border-warning/20 pb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-warning/20 p-2 text-warning shrink-0">
            <Warning aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-card-title font-semibold text-foreground">
              Localhost Target Detected ({targetUrl})
            </h2>
            <p className="mt-1 text-small text-muted-foreground">
              This hosted demo runs on our server — it cannot reach your machine&apos;s localhost directly.
            </p>
          </div>
        </div>

        {onDismiss ? (
          <button
            aria-label="Dismiss panel"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onDismiss}
            type="button"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      {/* Option 1 — Tunnel Mode (Recommended) */}
      <div className="mt-6 space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-caption font-bold text-brand-foreground">
            1
          </span>
          <h3 className="font-semibold text-small">
            Option 1: Free Cloudflare Quick Tunnel (Recommended · Works Now)
          </h3>
        </div>

        <p className="text-small text-muted-foreground leading-relaxed pl-8">
          Your app runs on your machine. A free Cloudflare tunnel gives it a temporary public URL that our crawler can reach.
        </p>

        <div className="pl-8 space-y-3">
          {/* Step A: Install */}
          <div>
            <p className="text-caption font-medium text-muted-foreground mb-1">
              Step A: Install cloudflared (Windows PowerShell):
            </p>
            <div className="flex items-center justify-between rounded-md border bg-surface-elevated px-3 py-2 font-mono text-caption">
              <span className="truncate">{installCmd}</span>
              <Button
                className="h-7 px-2 shrink-0 ml-2"
                onClick={() => void copyToClipboard(installCmd, 'install')}
                size="sm"
                type="button"
                variant="ghost"
              >
                {copiedInstall ? (
                  <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                <span className="ml-1 text-caption">{copiedInstall ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
            <p className="mt-1 text-caption text-muted-foreground">
              or download cloudflared from cloudflare.com
            </p>
          </div>

          {/* Step B: Run */}
          <div>
            <p className="text-caption font-medium text-muted-foreground mb-1">
              Step B: Start tunnel pointing at your app&apos;s port:
            </p>
            <div className="flex items-center justify-between rounded-md border bg-surface-elevated px-3 py-2 font-mono text-caption">
              <span className="truncate">{runCmd}</span>
              <Button
                className="h-7 px-2 shrink-0 ml-2"
                onClick={() => void copyToClipboard(runCmd, 'run')}
                size="sm"
                type="button"
                variant="ghost"
              >
                {copiedRun ? (
                  <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                <span className="ml-1 text-caption">{copiedRun ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
            <p className="mt-1 text-caption text-muted-foreground">
              Keep that terminal window open. Cloudflare will print a URL like{' '}
              <span className="font-mono text-brand">https://random-words.trycloudflare.com</span> — paste it below.
            </p>
          </div>

          {/* Step C: Paste & Proceed */}
          <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={handleTunnelSubmit}>
            <div className="relative flex-1">
              <LinkIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-9 font-mono text-small"
                onChange={(e) => {
                  setTunnelInput(e.target.value);
                  setTunnelError(null);
                }}
                placeholder="https://example-words.trycloudflare.com"
                type="url"
                value={tunnelInput}
              />
            </div>
            <Button size="default" type="submit">
              Use Tunnel URL
            </Button>
          </form>

          {tunnelError ? (
            <p className="text-small font-medium text-danger" role="alert">
              {tunnelError}
            </p>
          ) : null}
        </div>

        {/* Security Warning */}
        <div className="pl-8 pt-2">
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-caption text-muted-foreground">
            <span className="font-semibold text-warning">Security Note: </span>
            While the tunnel is open, anyone with the URL can reach your local app.
            Close the cloudflared terminal when you&apos;re done testing.
            Never tunnel an app containing real credentials or production data.
          </div>
        </div>
      </div>

      {/* Option 2 — Local Agent Mode */}
      <div className="mt-8 border-t border-warning/20 pt-6 space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-elevated text-caption font-bold text-muted-foreground border">
            2
          </span>
          <h3 className="font-semibold text-small">
            Option 2: Local Agent Mode (Direct localhost:4000)
          </h3>
        </div>

        <p className="text-small text-muted-foreground leading-relaxed pl-8">
          Run our backend engine locally (<code className="font-mono text-caption">pnpm dev</code> with{' '}
          <code className="font-mono text-caption">LOCAL_AGENT_MODE=true</code>). The hosted web UI will route API
          requests directly to your local machine.
        </p>

        <div className="pl-8 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            disabled={connectingLocal || currentMode === 'local-agent'}
            onClick={() => void handleConnectLocalAgent()}
            size="sm"
            type="button"
            variant="outline"
          >
            {connectingLocal ? (
              <CircleNotch aria-hidden="true" className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Cpu aria-hidden="true" className="h-4 w-4 mr-1.5" />
            )}
            {currentMode === 'local-agent' ? 'Connected to Local Agent' : 'Connect to Local Agent'}
          </Button>

          {currentMode === 'local-agent' ? (
            <Button
              onClick={() => {
                setApiMode('hosted');
                toast.success('Switched back to Hosted API mode');
                onModeChanged?.();
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Disconnect
            </Button>
          ) : null}
        </div>

        {localAgentNotice ? (
          <p className="pl-8 text-caption text-danger" role="alert">
            {localAgentNotice}
          </p>
        ) : null}
      </div>

      {/* Option 3 — Self-Host */}
      <div className="mt-6 border-t border-warning/20 pt-4 pl-8 flex items-center justify-between text-caption text-muted-foreground">
        <span>Option 3: Run the full stack locally with self-hosting.</span>
        <a
          className="inline-flex items-center gap-1 font-medium underline hover:text-foreground"
          href="https://github.com/vansh412f/agentic-test-case-generator"
          rel="noreferrer"
          target="_blank"
        >
          View GitHub Repository
          <ArrowSquareOut aria-hidden="true" className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

export default LocalTargetPanel;

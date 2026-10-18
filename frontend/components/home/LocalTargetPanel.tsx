import { useState } from 'react';
import {
  Globe,
  Copy,
  Check,
  Warning,
  ArrowRight,
  ArrowSquareOut,
  X,
  CircleNotch,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { classifyTarget, extractTargetPort } from '@/lib/targetUrl';
import { setApiMode } from '@/lib/api';

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
  const [copiedRun, setCopiedRun] = useState(false);
  const [connectingLocal, setConnectingLocal] = useState(false);
  const [localAgentNotice, setLocalAgentNotice] = useState<string | null>(null);

  const port = extractTargetPort(targetUrl, 3000);
  const command = `cloudflared tunnel --url http://localhost:${port} --http-host-header localhost:${port}`;

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRun(true);
      setTimeout(() => setCopiedRun(false), 2000);
      toast.success('Copied tunnel command to clipboard');
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
    <section className="state-panel local-panel relative">
      {onDismiss ? (
        <button
          aria-label="Dismiss panel"
          className="absolute right-4 top-4 rounded p-1 text-[#748078] hover:bg-[#e8ece5] hover:text-[#17201b]"
          onClick={onDismiss}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}

      <div className="state-icon">
        <Globe aria-hidden="true" className="h-6 w-6" />
      </div>

      <div className="state-copy">
        <p className="eyebrow">Local target detected</p>
        <h3>Your app is outside our reach</h3>
        <p>
          Our hosted agent can’t access localhost. Create a temporary public tunnel, then paste its URL below.
        </p>

        <div className="code-copy">
          <code>{command}</code>
          <button
            aria-label="Copy tunnel command"
            onClick={() => copyToClipboard(command)}
            type="button"
          >
            {copiedRun ? <Check className="h-4 w-4 text-[#a6e22e]" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>

        <form className="inline-form" onSubmit={handleTunnelSubmit}>
          <input
            aria-describedby={tunnelError ? 'tunnel-error' : undefined}
            onChange={(e) => setTunnelInput(e.target.value)}
            placeholder="https://your-app.trycloudflare.com"
            value={tunnelInput}
          />
          <button type="submit">
            Use tunnel URL <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </form>

        {tunnelError ? (
          <p className="mt-2 text-small font-medium text-danger" id="tunnel-error" role="alert">
            {tunnelError}
          </p>
        ) : null}

        <div className="warning">
          <Warning aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>
            <strong>Security note:</strong> This tunnel makes your local app public while it runs. Stop cloudflared when testing is complete.
          </span>
        </div>

        <details className="mt-3 text-xs text-[#5c6b61]">
          <summary className="cursor-pointer font-medium hover:text-[#17201b] select-none">
            Still blocked? (Vite, CRA, Angular, Next.js host header tips)
          </summary>
          <div className="mt-2 space-y-1.5 rounded-lg border border-[#e2e7df] bg-[#f4f6f3] p-3 text-[#3d4740]">
            <p>
              <strong>Vite:</strong> In <code>vite.config.ts</code>, add <code>server: &#123; allowedHosts: true &#125;</code> (or pass <code>--host</code>).
            </p>
            <p>
              <strong>Create React App:</strong> In <code>.env.development.local</code>, set <code>DANGEROUSLY_DISABLE_HOST_CHECK=true</code>.
            </p>
            <p>
              <strong>Angular:</strong> Run with <code>ng serve --disable-host-check</code>.
            </p>
            <p>
              <strong>Next.js:</strong> The <code>--http-host-header</code> flag satisfies Next.js by rewriting the host header to localhost.
            </p>
          </div>
        </details>

        <p className="alternative">
          Prefer not to expose it?{' '}
          <button
            disabled={connectingLocal}
            onClick={handleConnectLocalAgent}
            type="button"
          >
            {connectingLocal ? (
              <>
                <CircleNotch aria-hidden="true" className="h-3.5 w-3.5 animate-spin inline mr-1" />
                Connecting...
              </>
            ) : (
              <>
                Run the Agentic backend locally <ArrowSquareOut aria-hidden="true" className="h-3.5 w-3.5 inline ml-0.5" />
              </>
            )}
          </button>
        </p>

        {localAgentNotice ? (
          <p className="mt-2 text-caption text-danger" role="alert">
            {localAgentNotice}
          </p>
        ) : null}
      </div>
    </section>
  );
}

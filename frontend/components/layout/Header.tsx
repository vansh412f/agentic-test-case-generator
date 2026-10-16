import { useState, useEffect } from 'react';
import { ArrowSquareOut, ClockCounterClockwise, House, Key, Cpu, X } from '@phosphor-icons/react';
import Link from 'next/link';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ThemeToggle } from './ThemeToggle';
import { ApiKeysPanel } from '@/components/settings/ApiKeysPanel';
import { hasConfiguredKeys, getApiMode, setApiMode, type ApiMode } from '@/lib/api';

export function Header() {
  const [keysOpen, setKeysOpen] = useState(false);
  const [hasKeys, setHasKeys] = useState(false);
  const [apiMode, setApiModeState] = useState<ApiMode>('hosted');

  useEffect(() => {
    setHasKeys(hasConfiguredKeys());
    setApiModeState(getApiMode());

    const handleOpenModal = () => setKeysOpen(true);
    window.addEventListener('open-byok-modal', handleOpenModal);
    return () => window.removeEventListener('open-byok-modal', handleOpenModal);
  }, []);

  const refreshKeys = () => {
    setHasKeys(hasConfiguredKeys());
  };

  const handleDisconnectLocal = () => {
    setApiMode('hosted');
    setApiModeState('hosted');
    toast.success('Switched back to Hosted API mode');
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-shell items-center justify-between gap-gutter px-gutter">
          <Link
            aria-label="Agentic Test Case Generator home"
            className="flex min-h-11 items-center gap-3 rounded-control"
            href="/"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-control bg-brand font-mono text-small font-bold text-brand-foreground">
              &gt;_
            </span>
            <span className="hidden max-w-56 leading-tight sm:block">
              <span className="block font-bold">Agentic Test Case</span>
              <span className="block text-caption text-muted-foreground">
                Generator
              </span>
            </span>
          </Link>

          <nav aria-label="Primary" className="flex items-center gap-2">
            <Link
              className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-small font-medium transition-colors hover:bg-muted focus-visible:outline-none"
              href="/"
            >
              <House aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">Generate</span>
            </Link>

            <Link
              className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-small font-medium transition-colors hover:bg-muted focus-visible:outline-none"
              href="/jobs"
            >
              <ClockCounterClockwise aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">History</span>
            </Link>

            <Link
              className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-small font-medium transition-colors hover:bg-muted focus-visible:outline-none"
              href="/#how-it-works"
            >
              <span className="hidden sm:inline">How It Works</span>
            </Link>

            {apiMode === 'local-agent' ? (
              <span className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-small font-medium bg-info/10 border border-info/40 text-info">
                <Cpu aria-hidden="true" className="h-4 w-4" />
                <span className="hidden lg:inline">Local Agent</span>
                <button
                  aria-label="Disconnect local agent"
                  className="ml-1 rounded p-0.5 hover:bg-info/20 text-muted-foreground hover:text-foreground"
                  onClick={handleDisconnectLocal}
                  title="Disconnect from Local Agent"
                  type="button"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : null}

            <button
              className={clsx(
                'inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-small font-medium transition-colors border focus-visible:outline-none',
                hasKeys
                  ? 'bg-brand/10 border-brand/40 text-brand-strong dark:text-brand'
                  : 'text-muted-foreground border-transparent hover:bg-muted hover:text-foreground',
              )}
              onClick={() => setKeysOpen(true)}
              title={hasKeys ? 'Custom API keys active' : 'Configure custom API keys (BYOK)'}
              type="button"
            >
              <Key aria-hidden="true" className="h-4 w-4" />
              <span className="hidden md:inline">{hasKeys ? 'Your API keys' : 'API keys'}</span>
            </button>

            <a
              className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 text-small font-medium transition-colors hover:bg-muted focus-visible:outline-none text-muted-foreground hover:text-foreground"
              href="https://github.com/vansh412f/agentic-test-case-generator"
              rel="noreferrer"
              target="_blank"
            >
              <span className="hidden sm:inline">GitHub</span>
              <ArrowSquareOut aria-hidden="true" className="h-3.5 w-3.5" />
            </a>

            <ThemeToggle />
          </nav>
        </div>
      </header>

      <ApiKeysPanel
        onClose={() => setKeysOpen(false)}
        onKeysChanged={refreshKeys}
        open={keysOpen}
      />
    </>
  );
}

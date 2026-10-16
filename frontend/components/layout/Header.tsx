import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Sparkle, Cpu, X } from '@phosphor-icons/react';
import Link from 'next/link';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ApiKeysPanel } from '@/components/settings/ApiKeysPanel';
import { hasConfiguredKeys, getApiMode, setApiMode, type ApiMode } from '@/lib/api';

export function Header() {
  const router = useRouter();
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
      <header className="header">
        <Link
          aria-label="Agentic Test Case Generator home"
          className="brand"
          href="/"
        >
          <span className="logo-mark">
            <Sparkle aria-hidden="true" className="h-5 w-5" weight="fill" />
          </span>
          <span>
            Agentic<span>Test</span>
          </span>
        </Link>

        <nav aria-label="Primary">
          <Link
            className={clsx(router.pathname === '/' && 'active')}
            href="/"
          >
            Generate
          </Link>

          <Link
            className={clsx(router.pathname.startsWith('/jobs') && 'active')}
            href="/jobs"
          >
            History
          </Link>

          <button
            className={clsx(keysOpen && 'active')}
            onClick={() => setKeysOpen(true)}
            title={hasKeys ? 'Custom API keys active' : 'Configure custom API keys (BYOK)'}
            type="button"
          >
            API Keys
          </button>

          {apiMode === 'local-agent' ? (
            <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold bg-info/10 border border-info/40 text-info">
              <Cpu aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Local Agent</span>
              <button
                aria-label="Disconnect local agent"
                className="ml-1 rounded p-0.5 hover:bg-info/20 text-muted-foreground hover:text-foreground"
                onClick={handleDisconnectLocal}
                title="Disconnect from Local Agent"
                type="button"
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            </span>
          ) : null}
        </nav>

        <a
          aria-label="Open GitHub repository"
          className="icon-button"
          href="https://github.com/vansh412f/agentic-test-case-generator"
          rel="noreferrer"
          target="_blank"
          title="GitHub repository"
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4 fill-current"
            viewBox="0 0 24 24"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
            />
          </svg>
        </a>
      </header>

      <ApiKeysPanel
        onClose={() => setKeysOpen(false)}
        onKeysChanged={refreshKeys}
        open={keysOpen}
      />
    </>
  );
}

export default Header;

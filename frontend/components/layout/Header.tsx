import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { GithubLogo, Sparkle, Cpu, X } from '@phosphor-icons/react';
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
          <GithubLogo aria-hidden="true" className="h-5 w-5" />
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

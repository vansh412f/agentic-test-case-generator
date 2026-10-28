import { useState, useEffect, useRef } from 'react';
import {
  Key,
  Check,
  X,
  CircleNotch,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
  getStoredKeys,
  saveStoredKeys,
  clearStoredKeys,
  validateApiKey,
} from '@/lib/api';
import { forgetAllRememberedTestData } from '@/lib/rememberedTestData';

interface ApiKeysPanelProps {
  open: boolean;
  onClose: () => void;
  onKeysChanged?: () => void;
}

type ValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid';

export function ApiKeysPanel({
  open,
  onClose,
  onKeysChanged,
}: ApiKeysPanelProps) {
  const [groqKey, setGroqKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [groqStatus, setGroqStatus] = useState<ValidationStatus>('idle');
  const [geminiStatus, setGeminiStatus] = useState<ValidationStatus>('idle');
  const backdropMouseDownRef = useRef(false);

  useEffect(() => {
    if (open) {
      const stored = getStoredKeys();
      setGroqKey(stored.groq ?? '');
      setGeminiKey(stored.gemini ?? '');
      setGroqStatus('idle');
      setGeminiStatus('idle');
    }
  }, [open]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handleValidate(provider: 'groq' | 'gemini') {
    const key = provider === 'groq' ? groqKey : geminiKey;
    if (!key.trim()) {
      const msg = `Please enter a ${provider === 'groq' ? 'Groq' : 'Gemini'} key first.`;
      toast.error(msg);
      return;
    }

    if (provider === 'groq') setGroqStatus('validating');
    else setGeminiStatus('validating');

    try {
      const result = await validateApiKey(provider, key);
      if (result.valid) {
        if (provider === 'groq') setGroqStatus('valid');
        else setGeminiStatus('valid');
        toast.success(`${provider === 'groq' ? 'Groq' : 'Gemini'} API key is valid`);
      } else {
        if (provider === 'groq') setGroqStatus('invalid');
        else setGeminiStatus('invalid');
        const reason =
          result.reason === 'unreachable'
            ? 'Validation service unreachable. Check your network connection.'
            : `Invalid ${provider === 'groq' ? 'Groq' : 'Gemini'} API key.`;
        toast.error(reason);
      }
    } catch {
      if (provider === 'groq') setGroqStatus('invalid');
      else setGeminiStatus('invalid');
      toast.error('Validation request failed unexpectedly.');
    }
  }

  function handleSave() {
    saveStoredKeys({
      groq: groqKey.trim() || undefined,
      gemini: geminiKey.trim() || undefined,
    });
    toast.success('API keys saved to session storage');
    onKeysChanged?.();
    onClose();
  }

  function handleClear() {
    clearStoredKeys();
    setGroqKey('');
    setGeminiKey('');
    setGroqStatus('idle');
    setGeminiStatus('idle');
    toast.success('Stored API keys cleared');
    onKeysChanged?.();
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (backdropMouseDownRef.current && e.target === e.currentTarget) {
          onClose();
        }
        backdropMouseDownRef.current = false;
      }}
      role="dialog"
    >
      <div className="relative w-full max-w-2xl bg-[#f7f8f4] border border-[#dde2da] rounded-[14px] p-6 sm:p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto my-auto">
        <div className="flex items-start justify-between">
          <div className="page-title mb-0">
            <p className="eyebrow">SETTINGS</p>
            <h1 className="text-2xl font-bold">Bring your own API key</h1>
            <p className="text-xs text-[#78847c] mt-1">
              Keep generating beyond the free daily quota. Keys are stored in session storage only.
            </p>
          </div>
          <button
            aria-label="Close dialog"
            className="rounded p-1 text-[#78847c] hover:bg-[#e8ece5] hover:text-[#17201b]"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Groq Key Card */}
          <section className="key-card">
            <span className="state-icon">
              <Key aria-hidden="true" className="h-6 w-6" />
            </span>
            <div>
              <h2>Groq provider key</h2>
              <p>High-speed open-weight models for fast test planning and spec generation.</p>
              <label>
                GROQ API KEY
                <input
                  autoComplete="off"
                  onChange={(e) => {
                    setGroqKey(e.target.value);
                    setGroqStatus('idle');
                  }}
                  placeholder="gsk_••••••••••••••••"
                  spellCheck={false}
                  type="password"
                  value={groqKey}
                />
              </label>
              <div className="mt-3 flex items-center gap-3">
                <button
                  className="secondary-button"
                  disabled={!groqKey.trim() || groqStatus === 'validating'}
                  onClick={() => void handleValidate('groq')}
                  type="button"
                >
                  {groqStatus === 'validating' ? (
                    <>
                      <CircleNotch aria-hidden="true" className="h-4 w-4 animate-spin" /> Testing key…
                    </>
                  ) : groqStatus === 'valid' ? (
                    <>
                      <Check aria-hidden="true" className="h-4 w-4 text-[#507416]" /> Valid key
                    </>
                  ) : groqStatus === 'invalid' ? (
                    <>
                      <X aria-hidden="true" className="h-4 w-4 text-danger" /> Invalid key
                    </>
                  ) : (
                    'Test / Validate key'
                  )}
                </button>
              </div>
              <small>
                Free keys available at{' '}
                <a
                  className="underline text-[#507416]"
                  href="https://console.groq.com"
                  rel="noreferrer"
                  target="_blank"
                >
                  console.groq.com
                </a>
                .
              </small>
            </div>
          </section>

          {/* Gemini Key Card */}
          <section className="key-card">
            <span className="state-icon">
              <Key aria-hidden="true" className="h-6 w-6" />
            </span>
            <div>
              <h2>Gemini provider key</h2>
              <p>Google Gemini models for intelligent DOM reasoning, planning, and self-correction.</p>
              <label>
                GEMINI API KEY
                <input
                  autoComplete="off"
                  onChange={(e) => {
                    setGeminiKey(e.target.value);
                    setGeminiStatus('idle');
                  }}
                  placeholder="AIza••••••••••••••••"
                  spellCheck={false}
                  type="password"
                  value={geminiKey}
                />
              </label>
              <div className="mt-3 flex items-center gap-3">
                <button
                  className="secondary-button"
                  disabled={!geminiKey.trim() || geminiStatus === 'validating'}
                  onClick={() => void handleValidate('gemini')}
                  type="button"
                >
                  {geminiStatus === 'validating' ? (
                    <>
                      <CircleNotch aria-hidden="true" className="h-4 w-4 animate-spin" /> Testing key…
                    </>
                  ) : geminiStatus === 'valid' ? (
                    <>
                      <Check aria-hidden="true" className="h-4 w-4 text-[#507416]" /> Valid key
                    </>
                  ) : geminiStatus === 'invalid' ? (
                    <>
                      <X aria-hidden="true" className="h-4 w-4 text-danger" /> Invalid key
                    </>
                  ) : (
                    'Test / Validate key'
                  )}
                </button>
              </div>
              <small>
                Free keys available at{' '}
                <a
                  className="underline text-[#507416]"
                  href="https://aistudio.google.com"
                  rel="noreferrer"
                  target="_blank"
                >
                  aistudio.google.com
                </a>
                .
              </small>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-3 pt-4 border-t border-[#dde2da] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <button
              className="text-xs font-semibold text-danger hover:underline disabled:opacity-40 text-left"
              disabled={!groqKey && !geminiKey}
              onClick={handleClear}
              type="button"
            >
              Clear stored keys
            </button>
            <span className="hidden sm:inline text-[#cbd5e1]">·</span>
            <button
              className="text-xs font-semibold text-[#8c5000] hover:underline text-left"
              onClick={() => {
                forgetAllRememberedTestData();
                toast.success('Cleared all remembered test data for all sites');
              }}
              type="button"
            >
              Forget all test data
            </button>
          </div>

          <div className="flex gap-3 justify-end">
            <button
              className="secondary-button text-xs py-2 px-4"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="primary-button text-xs py-2 px-4"
              onClick={handleSave}
              type="button"
            >
              Save session keys
            </button>
          </div>
        </div>

        <p className="text-[10px] text-[#78847c] text-center">
          Keys are stored in sessionStorage ONLY. They are never saved on the server and are cleared when this browser tab closes.
        </p>
      </div>
    </div>
  );
}

export default ApiKeysPanel;

import { useState, useEffect } from 'react';
import { Key, CheckCircle, XCircle, CircleNotch, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  getStoredKeys,
  saveStoredKeys,
  clearStoredKeys,
  validateApiKey,
} from '@/lib/api';

interface ApiKeysPanelProps {
  open: boolean;
  onClose: () => void;
  onKeysChanged?: () => void;
}

type ValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid';

export function ApiKeysPanel({ open, onClose, onKeysChanged }: ApiKeysPanelProps) {
  const [groqKey, setGroqKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [groqStatus, setGroqStatus] = useState<ValidationStatus>('idle');
  const [geminiStatus, setGeminiStatus] = useState<ValidationStatus>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const stored = getStoredKeys();
      setGroqKey(stored.groq ?? '');
      setGeminiKey(stored.gemini ?? '');
      setGroqStatus('idle');
      setGeminiStatus('idle');
      setStatusMessage(null);
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
      setStatusMessage(msg);
      toast.error(msg);
      return;
    }

    if (provider === 'groq') setGroqStatus('validating');
    else setGeminiStatus('validating');

    setStatusMessage(null);

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
        setStatusMessage(reason);
        toast.error(reason);
      }
    } catch {
      if (provider === 'groq') setGroqStatus('invalid');
      else setGeminiStatus('invalid');
      setStatusMessage('Validation failed unexpectedly.');
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
    setStatusMessage('All stored API keys cleared.');
    toast.success('Stored API keys cleared');
    onKeysChanged?.();
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="panel max-w-lg w-full p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b pb-4">
          <div className="flex items-center gap-2">
            <Key aria-hidden="true" className="h-5 w-5 text-brand" />
            <h2 className="text-card-title font-semibold">Custom API Keys (BYOK)</h2>
          </div>
          <button
            aria-label="Close dialog"
            className="rounded-md p-1 text-muted-foreground hover:bg-surface-elevated hover:text-foreground transition-colors"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-4 text-small text-muted-foreground leading-relaxed">
          Supply your own free-tier or paid keys to bypass the global daily quota.
          Keys live only in this tab&apos;s session storage, are sent per-request over HTTPS,
          and are never stored on the server.
        </p>

        <div className="mt-6 space-y-5">
          {/* Groq Key Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-small font-medium" htmlFor="groq-key">
                Groq API Key
              </Label>
              <span className="text-caption text-muted-foreground font-mono">Free at console.groq.com</span>
            </div>
            <div className="flex gap-2">
              <Input
                autoComplete="off"
                className="font-mono text-small flex-1"
                id="groq-key"
                onChange={(e) => {
                  setGroqKey(e.target.value);
                  setGroqStatus('idle');
                }}
                placeholder="gsk_..."
                spellCheck={false}
                type="password"
                value={groqKey}
              />
              <Button
                disabled={!groqKey.trim() || groqStatus === 'validating'}
                onClick={() => void handleValidate('groq')}
                size="sm"
                type="button"
                variant="outline"
              >
                {groqStatus === 'validating' ? (
                  <CircleNotch aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : groqStatus === 'valid' ? (
                  <CheckCircle aria-hidden="true" className="h-4 w-4 text-success" />
                ) : groqStatus === 'invalid' ? (
                  <XCircle aria-hidden="true" className="h-4 w-4 text-danger" />
                ) : (
                  'Validate'
                )}
              </Button>
            </div>
          </div>

          {/* Gemini Key Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-small font-medium" htmlFor="gemini-key">
                Gemini API Key
              </Label>
              <span className="text-caption text-muted-foreground font-mono">Free at aistudio.google.com</span>
            </div>
            <div className="flex gap-2">
              <Input
                autoComplete="off"
                className="font-mono text-small flex-1"
                id="gemini-key"
                onChange={(e) => {
                  setGeminiKey(e.target.value);
                  setGeminiStatus('idle');
                }}
                placeholder="AIza..."
                spellCheck={false}
                type="password"
                value={geminiKey}
              />
              <Button
                disabled={!geminiKey.trim() || geminiStatus === 'validating'}
                onClick={() => void handleValidate('gemini')}
                size="sm"
                type="button"
                variant="outline"
              >
                {geminiStatus === 'validating' ? (
                  <CircleNotch aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : geminiStatus === 'valid' ? (
                  <CheckCircle aria-hidden="true" className="h-4 w-4 text-success" />
                ) : geminiStatus === 'invalid' ? (
                  <XCircle aria-hidden="true" className="h-4 w-4 text-danger" />
                ) : (
                  'Validate'
                )}
              </Button>
            </div>
          </div>
        </div>

        {statusMessage ? (
          <p className="mt-4 text-caption text-muted-foreground" role="alert">
            {statusMessage}
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-between border-t pt-4">
          <Button
            className="text-danger hover:text-danger hover:bg-danger/10"
            disabled={!groqKey && !geminiKey}
            onClick={handleClear}
            size="sm"
            type="button"
            variant="ghost"
          >
            Clear Keys
          </Button>

          <div className="flex gap-2">
            <Button onClick={onClose} size="sm" type="button" variant="outline">
              Cancel
            </Button>
            <Button onClick={handleSave} size="sm" type="button">
              Save Keys
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ApiKeysPanel;

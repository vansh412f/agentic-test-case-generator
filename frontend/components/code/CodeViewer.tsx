import { Check, Copy, FileCode2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/useMediaQuery';

const MonacoEditor = dynamic(
  () => import('@monaco-editor/react').then((module) => module.Editor),
  {
    ssr: false,
    loading: () => (
      <div aria-label="Loading code editor" className="skeleton-line h-64 w-full" role="status" />
    ),
  },
);

interface CodeViewerProps {
  code: string;
  filename: string;
}

export function CodeViewer({ code, filename }: CodeViewerProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const showEditor = !isMobile || expanded;

  return (
    <div className="overflow-hidden rounded-panel border bg-background">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b px-4">
        <p className="flex min-w-0 items-center gap-2 font-mono text-small">
          <FileCode2 aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-strong dark:text-brand" />
          <span className="truncate">{filename}</span>
        </p>

        <div className="flex shrink-0 items-center gap-2">
          {isMobile ? (
            <Button
              onClick={() => setExpanded((value) => !value)}
              size="sm"
              type="button"
              variant="outline"
            >
              {expanded ? 'Collapse Code' : 'View Full Code'}
            </Button>
          ) : null}

          <Button
            aria-label={copied ? 'Code copied' : `Copy ${filename}`}
            onClick={() => void copyCode()}
            size="icon"
            type="button"
            variant="ghost"
          >
            {copied ? (
              <Check aria-hidden="true" className="text-success" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      {showEditor ? (
        <div className="h-80">
          <MonacoEditor
            language="typescript"
            loading={<div className="skeleton-line h-full w-full" />}
            options={{
              automaticLayout: true,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 13,
              lineNumbersMinChars: 3,
              minimap: { enabled: false },
              padding: { top: 16, bottom: 16 },
              readOnly: true,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
            }}
            theme="vs-dark"
            value={code}
          />
        </div>
      ) : (
        <pre className="max-h-48 overflow-auto p-4 font-mono text-caption leading-relaxed">
          {code}
        </pre>
      )}
    </div>
  );
}

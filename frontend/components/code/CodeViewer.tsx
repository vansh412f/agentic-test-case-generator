import { Check, Copy } from '@phosphor-icons/react';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { toast } from 'sonner';

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
  highlightLine?: number;
  editable?: boolean;
  onChange?: (code: string) => void;
}

export function CodeViewer({ code, filename, highlightLine, editable, onChange }: CodeViewerProps) {
  const [copied, setCopied] = useState(false);
  const editing = Boolean(editable && onChange);

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(`Copied ${filename} to clipboard`);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      toast.error('Failed to copy to clipboard');
    }
  }

  return (
    <div className="code-view">
      <div className="code-top">
        <span>{filename}</span>
        <button onClick={() => void copyCode()} type="button">
          {copied ? (
            <Check aria-hidden="true" className="h-3.5 w-3.5 text-[#a6e22e]" />
          ) : (
            <Copy aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="h-80">
        <MonacoEditor
          language="typescript"
          loading={<div className="skeleton-line h-full w-full" />}
          onChange={(value) => onChange?.(value ?? '')}
          onMount={(editor, monaco) => {
            if (highlightLine && highlightLine > 0) {
              editor.revealLineInCenter(highlightLine);
              editor.deltaDecorations(
                [],
                [
                  {
                    range: new monaco.Range(highlightLine, 1, highlightLine, 1),
                    options: {
                      isWholeLine: true,
                      className: 'failing-line-highlight',
                    },
                  },
                ],
              );
            }
          }}
          options={{
            automaticLayout: true,
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 12,
            lineNumbersMinChars: 3,
            minimap: { enabled: false },
            padding: { top: 12, bottom: 12 },
            readOnly: !editing,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
          }}
          theme="vs-dark"
          value={code}
        />
      </div>
    </div>
  );
}

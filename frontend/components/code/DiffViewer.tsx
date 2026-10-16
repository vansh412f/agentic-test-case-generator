import dynamic from 'next/dynamic';
import { useMediaQuery } from '@/hooks/useMediaQuery';

const MonacoDiffEditor = dynamic(
  () => import('@monaco-editor/react').then((module) => module.DiffEditor),
  {
    ssr: false,
    loading: () => (
      <div aria-label="Loading correction diff" className="skeleton-line h-72 w-full" role="status" />
    ),
  },
);

interface DiffViewerProps {
  original: string;
  modified: string;
}

export function DiffViewer({ original, modified }: DiffViewerProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');

  return (
    <div className="h-80 overflow-hidden rounded-panel border bg-background">
      <MonacoDiffEditor
        language="typescript"
        loading={<div className="skeleton-line h-full w-full" />}
        modified={modified}
        options={{
          automaticLayout: true,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 12,
          minimap: { enabled: false },
          originalEditable: false,
          padding: { top: 12, bottom: 12 },
          readOnly: true,
          renderSideBySide: !isMobile,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
        }}
        original={original}
        theme="vs-dark"
      />
    </div>
  );
}

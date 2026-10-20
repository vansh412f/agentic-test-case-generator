import React from 'react';
import { WarningCircle, CaretRight } from '@phosphor-icons/react';

export interface ErrorNoticeProps {
  title: string;
  body: string;
  hint?: string;
  raw?: string;
  className?: string;
}

export const ErrorNotice: React.FC<ErrorNoticeProps> = ({
  title,
  body,
  hint,
  raw,
  className = '',
}) => {
  const showRaw = Boolean(raw && raw.trim() !== body.trim());

  return (
    <div
      className={`rounded-xl border border-red-900 bg-zinc-950 p-4 text-left shadow-sm ${className}`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0 text-red-400">
          <WarningCircle size={20} weight="fill" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-red-400">{title}</h3>
          <p className="mt-1 text-xs sm:text-sm text-red-300/90 leading-relaxed">{body}</p>

          {hint && (
            <div className="mt-2.5 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300 flex items-start gap-1.5">
              <span className="font-medium text-red-200">Tip:</span>
              <span>{hint}</span>
            </div>
          )}

          {showRaw && (
            <details className="mt-3 group text-xs">
              <summary className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400/80 hover:text-red-300 cursor-pointer select-none">
                <CaretRight
                  size={12}
                  className="transition-transform group-open:rotate-90"
                />
                Technical details
              </summary>
              <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 font-mono text-[11px] text-slate-300 whitespace-pre-wrap break-all">
                {raw}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
};

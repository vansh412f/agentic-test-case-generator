import React, { useState } from 'react';
import { Lock, LockOpen } from '@phosphor-icons/react';
import type { InteractiveElement } from '@/types/api';
import {
  saveRememberedTestData,
  forgetRememberedTestData,
} from '@/lib/rememberedTestData';

export interface PageInfo {
  url: string;
  title?: string;
  elements: InteractiveElement[];
}

export interface PageTestDataProps {
  pages: PageInfo[];
  testDataByUrl: Record<string, Record<string, { value: string; sensitive: boolean }>>;
  onUpdateField: (pageUrl: string, elementId: string, value: string, sensitive: boolean) => void;
  disabled?: boolean;
}

const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

export function getEligibleFields(elements: InteractiveElement[]): InteractiveElement[] {
  return elements
    .filter((el) => {
      if (el.isVisible === false) return false;
      if (el.isReadOnly) return false;
      if (!['input', 'textarea', 'select'].includes(el.type)) return false;
      if (el.inputType && EXCLUDED_INPUT_TYPES.has(el.inputType.toLowerCase())) return false;
      return true;
    })
    .slice(0, 30);
}

export function PageTestData({
  pages,
  testDataByUrl,
  onUpdateField,
  disabled = false,
}: PageTestDataProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [rememberOnBrowser, setRememberOnBrowser] = useState(true);

  // Determine if ANY selected page has eligible fields
  const pagesWithFields = pages.map((page) => ({
    page,
    fields: getEligibleFields(page.elements),
  }));

  const totalFields = pagesWithFields.reduce((sum, p) => sum + p.fields.length, 0);

  // If none of the selected pages have any input fields, don't show the panel
  if (totalFields === 0) {
    return null;
  }

  const handleRememberChange = (checked: boolean) => {
    setRememberOnBrowser(checked);
    for (const p of pages) {
      if (checked) {
        saveRememberedTestData(p.url, testDataByUrl[p.url] ?? {}, p.elements);
      } else {
        forgetRememberedTestData(p.url);
      }
    }
  };

  const getPageHeader = (page: PageInfo) => {
    try {
      const u = new URL(page.url);
      const path = u.pathname + (u.search || '');
      return page.title ? `${page.title} (${path})` : path || page.url;
    } catch {
      return page.title ? `${page.title} (${page.url})` : page.url;
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-950/50 hover:bg-slate-100/80 dark:hover:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors border-b border-slate-200 dark:border-slate-800"
      >
        <span className="flex items-center gap-2">
          <span>Test data</span>
          <span className="text-slate-400 dark:text-slate-500 font-normal">
            · {totalFields} field{totalFields === 1 ? '' : 's'} across {pages.length} page{pages.length === 1 ? '' : 's'} · optional
          </span>
        </span>
        <span className="text-[11px] text-slate-500">
          {isExpanded ? '▲ Collapse' : '▼ Expand'}
        </span>
      </button>

      {isExpanded && (
        <div className="p-4 space-y-6">
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 p-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
            Provide test credentials or form data for your scenarios. Secret values are used only during test execution, never stored, and redacted from report outputs.
          </div>

          {pagesWithFields.map(({ page, fields }) => (
            <div key={page.url} className="space-y-3">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-1.5 flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  {getPageHeader(page)}
                </h4>
                <span className="text-[11px] text-slate-400">
                  {fields.length} field{fields.length === 1 ? '' : 's'}
                </span>
              </div>

              {fields.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-1">
                  No input fields found on this page.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {fields.map((field) => {
                    const label =
                      field.ariaLabel ||
                      field.placeholder ||
                      field.name ||
                      field.text ||
                      field.id;
                    const pageData = testDataByUrl[page.url] ?? {};
                    const entry = pageData[field.id] ?? {
                      value: '',
                      sensitive: field.inputType === 'password',
                    };

                    return (
                      <div
                        key={field.id}
                        className="grid grid-cols-1 sm:grid-cols-[140px_1fr_auto] gap-2 items-center"
                      >
                        <label
                          htmlFor={`td-${page.url}-${field.id}`}
                          className="text-xs text-slate-700 dark:text-slate-300 truncate"
                          title={label}
                        >
                          {label}
                        </label>
                        <input
                          id={`td-${page.url}-${field.id}`}
                          type={entry.sensitive ? 'password' : 'text'}
                          value={entry.value}
                          placeholder={field.placeholder || 'Value...'}
                          disabled={disabled}
                          onChange={(e) => {
                            const val = e.target.value;
                            onUpdateField(page.url, field.id, val, entry.sensitive);
                            if (rememberOnBrowser) {
                              const updated = {
                                ...pageData,
                                [field.id]: { value: val, sensitive: entry.sensitive },
                              };
                              saveRememberedTestData(page.url, updated, page.elements);
                            }
                          }}
                          className="px-2.5 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            const newSensitive = !entry.sensitive;
                            onUpdateField(page.url, field.id, entry.value, newSensitive);
                            if (rememberOnBrowser) {
                              const updated = {
                                ...pageData,
                                [field.id]: { value: entry.value, sensitive: newSensitive },
                              };
                              saveRememberedTestData(page.url, updated, page.elements);
                            }
                          }}
                          title={
                            entry.sensitive
                              ? 'Marked as Secret (never stored, redacted from reports)'
                              : 'Plain text'
                          }
                          className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md border transition-colors ${
                            entry.sensitive
                              ? 'border-rose-500/50 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                              : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {entry.sensitive ? (
                            <>
                              <Lock size={12} weight="fill" /> Secret
                            </>
                          ) : (
                            <>
                              <LockOpen size={12} /> Plain
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberOnBrowser}
                onChange={(e) => handleRememberChange(e.target.checked)}
                className="rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
              />
              <span>Remember test data (stored in this browser only)</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

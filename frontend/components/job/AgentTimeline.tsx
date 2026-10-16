import {
  Bot,
  CheckCircle2,
  Globe2,
  ListChecks,
  PlayCircle,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { formatDurationMs, formatTime } from '@/lib/utils';
import type { AgentStep, StepType } from '@/types/api';

const iconByStep: Record<StepType, typeof Globe2> = {
  crawl: Globe2,
  plan: ListChecks,
  generate: Bot,
  validate: ShieldCheck,
  execute: PlayCircle,
  correct: Wrench,
};

interface AgentTimelineProps {
  steps: AgentStep[];
}

export function AgentTimeline({ steps }: AgentTimelineProps) {
  if (steps.length === 0) {
    return (
      <p className="rounded-panel border border-dashed p-4 text-small text-muted-foreground">
        No agent steps have been recorded yet.
      </p>
    );
  }

  return (
    <ol className="relative space-y-5">
      <span aria-hidden="true" className="absolute bottom-2 left-4 top-2 w-px bg-border" />

      {steps.map((step) => {
        const Icon = iconByStep[step.stepType];
        const failed = step.status === 'failure';

        return (
          <li className="relative flex gap-4" key={step.id}>
            <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-surface">
              <Icon
                aria-hidden="true"
                className={failed ? 'h-4 w-4 text-danger' : 'h-4 w-4 text-brand-strong dark:text-brand'}
              />
            </span>

            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-small font-bold uppercase">
                  {step.stepType}
                </p>
                {failed ? (
                  <XCircle aria-hidden="true" className="h-4 w-4 text-danger" />
                ) : (
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-success" />
                )}
                <time className="font-mono text-caption text-muted-foreground">
                  {formatTime(step.createdAt)}
                </time>
              </div>

              <p className="mt-1 font-mono text-caption text-muted-foreground">
                {step.testCaseId ?? 'job'}
                {step.attemptNumber !== null ? ` · attempt ${step.attemptNumber}` : ''}
                {' · '}
                {formatDurationMs(step.latencyMs)}
              </p>

              {step.llmProvider || step.llmModel ? (
                <p className="mt-1 break-all font-mono text-caption">
                  {step.llmProvider ?? 'unknown provider'}
                  {step.llmModel ? ` / ${step.llmModel}` : ''}
                </p>
              ) : null}

              {step.errorDetail ? (
                <p className="mt-2 break-words rounded-control border border-danger/30 bg-danger/10 p-3 font-mono text-caption">
                  {step.errorDetail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

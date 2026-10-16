import { formatUsd } from '@/lib/utils';
import type { AgentStep, CostEstimate, StepType } from '@/types/api';

interface TokenUsageProps {
  steps: AgentStep[];
  costEstimate: CostEstimate;
}

const stepOrder: StepType[] = ['plan', 'generate', 'correct'];

export function TokenUsage({ steps, costEstimate }: TokenUsageProps) {
  const llmSteps = steps.filter((step) => step.llmProvider !== null);

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="w-full min-w-72 text-left text-small">
          <thead>
            <tr className="border-b font-mono text-caption uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-medium" scope="col">Step</th>
              <th className="py-2 pr-3 font-medium" scope="col">Calls</th>
              <th className="py-2 pr-3 font-medium" scope="col">Prompt</th>
              <th className="py-2 font-medium" scope="col">Completion</th>
            </tr>
          </thead>
          <tbody>
            {stepOrder.map((stepType) => {
              const rows = llmSteps.filter((step) => step.stepType === stepType);

              return (
                <tr className="border-b" key={stepType}>
                  <th className="py-3 pr-3 font-mono font-medium" scope="row">
                    {stepType}
                  </th>
                  <td className="py-3 pr-3 font-mono">{rows.length}</td>
                  <td className="py-3 pr-3 font-mono">
                    {rows.reduce((sum, step) => sum + (step.promptTokens ?? 0), 0)}
                  </td>
                  <td className="py-3 font-mono">
                    {rows.reduce((sum, step) => sum + (step.completionTokens ?? 0), 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-panel border bg-background p-4">
        <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          Estimated LLM cost
        </p>
        <p className="mt-2 font-mono text-heading-2 font-bold">
          {formatUsd(costEstimate.totalUsd)}
        </p>
        <p className="mt-1 font-mono text-caption text-muted-foreground">
          {costEstimate.calls} calls · {costEstimate.totalTokens} reported tokens
        </p>

        {costEstimate.unpricedCalls > 0 ? (
          <p className="mt-3 text-caption text-warning">
            {costEstimate.unpricedCalls} call(s) had no pricing entry. This
            total is a lower bound.
          </p>
        ) : null}
      </div>

      {costEstimate.byProvider.length > 0 ? (
        <ul className="space-y-3">
          {costEstimate.byProvider.map((provider) => (
            <li
              className="flex items-center justify-between gap-4 rounded-panel border bg-background p-4"
              key={provider.provider}
            >
              <div>
                <p className="font-mono text-small font-bold">{provider.provider}</p>
                <p className="font-mono text-caption text-muted-foreground">
                  {provider.calls} calls · {provider.totalTokens} tokens
                </p>
              </div>
              <p className="font-mono text-small font-bold">
                {formatUsd(provider.usd)}
                {!provider.priced ? (
                  <span className="block text-caption font-normal text-warning">
                    lower bound
                  </span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

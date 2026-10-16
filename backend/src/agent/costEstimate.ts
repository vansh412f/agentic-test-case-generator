import { MODEL_PRICING_USD_PER_MILLION } from '../llm/pricing.config.ts';

// Structural subset of an AgentStep row — no Prisma import, so this stays
// usable (and testable) without a generated client or a database.
export interface CostStepInput {
  llmProvider: string | null;
  llmModel: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface ProviderCostBreakdown {
  provider: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  usd: number;
  // False when at least one call used a model with no pricing entry;
  // that provider's usd is then a lower bound, not a total.
  priced: boolean;
}

export interface CostEstimate {
  totalUsd: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  calls: number;
  unpricedCalls: number;
  byProvider: ProviderCostBreakdown[];
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

// Pricing is applied per call (keyed by that call's model) before
// aggregating by provider, so a provider serving two models mid-job
// is still costed correctly.
export function estimateJobCost(steps: readonly CostStepInput[]): CostEstimate {
  const byProvider = new Map<string, ProviderCostBreakdown>();
  let totalUsd = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let calls = 0;
  let unpricedCalls = 0;

  for (const step of steps) {
    if (step.llmProvider === null) continue;
    const promptTokens = step.promptTokens ?? 0;
    const completionTokens = step.completionTokens ?? 0;
    calls += 1;
    totalPromptTokens += promptTokens;
    totalCompletionTokens += completionTokens;

    const pricing = step.llmModel === null
      ? undefined
      : MODEL_PRICING_USD_PER_MILLION[step.llmModel];
    const usd = pricing === undefined
      ? 0
      : (promptTokens * pricing.promptUsdPerMillion
        + completionTokens * pricing.completionUsdPerMillion) / 1_000_000;
    if (pricing === undefined) unpricedCalls += 1;
    totalUsd += usd;

    const row = byProvider.get(step.llmProvider) ?? {
      provider: step.llmProvider,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      usd: 0,
      priced: true,
    };
    row.calls += 1;
    row.promptTokens += promptTokens;
    row.completionTokens += completionTokens;
    row.totalTokens += promptTokens + completionTokens;
    row.usd += usd;
    row.priced = row.priced && pricing !== undefined;
    byProvider.set(step.llmProvider, row);
  }

  const rows = [...byProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  for (const row of rows) row.usd = roundUsd(row.usd);

  return {
    totalUsd: roundUsd(totalUsd),
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
    calls,
    unpricedCalls,
    byProvider: rows,
  };
}

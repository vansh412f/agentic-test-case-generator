// Structural subset of an AgentStep row — no Prisma import, so this stays
// usable (and testable) without a generated client or a database.
export interface TokenStepInput {
  llmProvider: string | null;
  llmModel: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface TokenUsageRow {
  provider: string;
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface TokenUsage {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  rows: TokenUsageRow[];
}

export function summarizeTokenUsage(steps: readonly TokenStepInput[]): TokenUsage {
  const rowMap = new Map<string, TokenUsageRow>();
  let promptTokens = 0;
  let completionTokens = 0;

  for (const step of steps) {
    if (step.llmProvider === null) continue;
    const p = step.promptTokens ?? 0;
    const c = step.completionTokens ?? 0;
    promptTokens += p;
    completionTokens += c;

    const provider = step.llmProvider;
    const model = step.llmModel ?? 'unknown';
    const key = `${provider}::${model}`;

    const existing = rowMap.get(key);
    if (existing !== undefined) {
      existing.calls += 1;
      existing.promptTokens += p;
      existing.completionTokens += c;
    } else {
      rowMap.set(key, {
        provider,
        model,
        calls: 1,
        promptTokens: p,
        completionTokens: c,
      });
    }
  }

  const rows = Array.from(rowMap.values()).sort((a, b) => {
    const provCmp = a.provider.localeCompare(b.provider);
    if (provCmp !== 0) return provCmp;
    return a.model.localeCompare(b.model);
  });

  return {
    totalTokens: promptTokens + completionTokens,
    promptTokens,
    completionTokens,
    rows,
  };
}

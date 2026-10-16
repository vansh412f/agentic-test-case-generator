import { recordAgentStep } from '../db/agentSteps.ts';
import type { AgentStepInput } from '../db/agentSteps.ts';
import { safeWrite } from '../db/safeWrite.ts';
import { withLlmObserver } from '../llm/telemetry.ts';
import { GEMINI_DEFAULT_MODEL, GROQ_DEFAULT_MODEL } from '../llm/providers.config.ts';
import type { LlmProviderName } from '../llm/providers.config.ts';

const PROVIDER_MODELS: Record<LlmProviderName, string> = {
  groq: GROQ_DEFAULT_MODEL,
  gemini: GEMINI_DEFAULT_MODEL,
};

interface StepContext {
  jobId: string;
  testCaseId?: string;
  attemptNumber?: number;
}

export async function recordStep(input: AgentStepInput): Promise<void> {
  await safeWrite(`recordAgentStep:${input.stepType}`, () => recordAgentStep(input));
}

export function withLlmStep<T>(
  context: StepContext,
  stepType: 'plan' | 'generate' | 'correct',
  operation: () => Promise<T>,
): Promise<T> {
  return withLlmObserver(async (event) => {
    const model = event.model === 'unknown'
      ? PROVIDER_MODELS[event.provider]
      : event.model;
    await recordStep({
      ...context,
      stepType,
      status: event.success ? 'success' : 'failure',
      llmProvider: event.provider,
      llmModel: model,
      latencyMs: event.latencyMs,
      promptTokens: event.usage?.promptTokens,
      completionTokens: event.usage?.completionTokens,
      errorDetail: event.errorMessage,
      createdAt: new Date(event.timestamp),
    });
  }, operation);
}

export async function withMeasuredStep<T>(
  context: StepContext,
  stepType: 'crawl' | 'validate' | 'execute',
  operation: () => Promise<T>,
  outcome: (result: T) => { success: boolean; error?: string },
): Promise<T> {
  const start = new Date();
  let result: T;
  try {
    result = await operation();
  } catch (error) {
    await recordStep({
      ...context, stepType, status: 'failure', createdAt: start,
      latencyMs: Date.now() - start.getTime(),
      errorDetail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const duration = Date.now() - start.getTime();
  const { success, error } = outcome(result);
  await recordStep({
    ...context, stepType, status: success ? 'success' : 'failure',
    createdAt: start, latencyMs: duration, errorDetail: error,
  });
  return result;
}

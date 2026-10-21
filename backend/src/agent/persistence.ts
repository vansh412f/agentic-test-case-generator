import { recordAgentStep } from '../db/agentSteps.ts';
import type { AgentStepInput } from '../db/agentSteps.ts';
import { safeWrite } from '../db/safeWrite.ts';
import { withLlmObserver } from '../llm/telemetry.ts';
import { GEMINI_DEFAULT_MODEL, GROQ_DEFAULT_MODEL } from '../llm/providers.config.ts';
import type { LlmProviderName } from '../llm/providers.config.ts';
import { publishJobEvent } from './jobEvents.ts';

const PROVIDER_MODELS: Record<LlmProviderName, string> = {
  groq: GROQ_DEFAULT_MODEL,
  gemini: GEMINI_DEFAULT_MODEL,
  nvidia: 'openai/gpt-oss-20b',
};

interface StepContext {
  jobId: string;
  testCaseId?: string;
  attemptNumber?: number;
}

export async function recordStep(input: AgentStepInput): Promise<void> {
  await safeWrite(`recordAgentStep:${input.stepType}`, () => recordAgentStep(input));
  // Published even when the DB write was skipped: the stream must not depend on persistence.
  publishJobEvent(input.jobId, {
    type: 'step_recorded',
    data: {
      stepType: input.stepType,
      status: input.status,
      testCaseId: input.testCaseId ?? null,
      attemptNumber: input.attemptNumber ?? null,
    },
  });
}

export function withLlmStep<T>(
  context: StepContext,
  stepType: 'plan' | 'generate' | 'correct',
  operation: () => Promise<T>,
  onUsage?: (promptTokens?: number, completionTokens?: number) => void,
): Promise<T> {
  return withLlmObserver(async (event) => {
    if (onUsage) {
      onUsage(event.usage?.promptTokens, event.usage?.completionTokens);
    }
    const model = event.model === 'unknown'
      ? PROVIDER_MODELS[event.provider]
      : event.model;
    const attemptNumber = stepType === 'plan'
      ? (event.purpose === 'plan' ? 1 : event.purpose === 'repair' ? 2 : event.purpose === 'expand' ? 3 : context.attemptNumber)
      : context.attemptNumber;
    await recordStep({
      ...context,
      attemptNumber,
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
  stepType: 'crawl' | 'observe' | 'validate' | 'execute' | 'generate',
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
// Module component implementation.

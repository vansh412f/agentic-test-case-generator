import type { StepStatus, StepType } from '@prisma/client';
import { prisma } from './client.ts';

export interface AgentStepInput {
  jobId: string;
  stepType: StepType;
  testCaseId?: string;
  attemptNumber?: number;
  status: StepStatus;
  latencyMs?: number;
  llmProvider?: string;
  llmModel?: string;
  promptTokens?: number;
  completionTokens?: number;
  errorDetail?: string;
  createdAt?: Date;
}

export function recordAgentStep(input: AgentStepInput) {
  return prisma.agentStep.create({ data: input });
}
// Module component implementation.

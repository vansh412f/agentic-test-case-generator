import type { FailureClass } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from './client.ts';
import { toDatabaseJson } from './json.ts';

export interface AttemptInput {
  attemptNumber: number;
  code: string;
  validationPassed: boolean;
  validationErrors?: string[];
  executionPassed?: boolean;
  executionError?: string;
  failureClass?: FailureClass;
  failureContext?: unknown;
  durationMs?: number;
  corrected: boolean;
}

export function recordExecutionResult(
  input: AttemptInput & { generatedTestId: string },
  database: Prisma.TransactionClient = prisma,
) {
  const { validationErrors, failureContext, ...data } = input;
  return database.executionResult.create({
    data: {
      ...data,
      ...(validationErrors ? { validationErrors: toDatabaseJson(validationErrors) } : {}),
      ...(failureContext !== undefined ? { failureContext: toDatabaseJson(failureContext) } : {}),
    },
  });
}
// Module component implementation.

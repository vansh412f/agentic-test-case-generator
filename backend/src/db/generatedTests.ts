import type { TestStatus } from '@prisma/client';
import { prisma } from './client.ts';
import { recordExecutionResult } from './executionResults.ts';
import type { AttemptInput } from './executionResults.ts';

interface GeneratedTestInput {
  jobId: string;
  testCaseId: string;
  filename: string;
  finalCode: string;
  finalStatus: TestStatus;
  attempts: AttemptInput[];
}

export function recordGeneratedTest(input: GeneratedTestInput) {
  const { attempts, ...data } = input;
  return prisma.$transaction(async (transaction) => {
    const test = await transaction.generatedTest.create({
      data: { ...data, totalAttempts: attempts.length },
    });
    for (const attempt of attempts) {
      await recordExecutionResult({ ...attempt, generatedTestId: test.id }, transaction);
    }
    return test;
  });
}
// Module component implementation.

import type { JobStatus } from '@prisma/client';
import type { AppMap } from '../crawler/types.ts';
import type { TestPlan } from '../agent/prompts/plannerPrompt.ts';
import { prisma } from './client.ts';
import { DatabaseError } from './errors.ts';
import { toDatabaseJson } from './json.ts';

export function createJob(input: { id: string; targetUrl: string }) {
  return prisma.job.create({ data: { ...input, status: 'crawling', startedAt: new Date() } });
}

export function updateJobStatus(id: string, status: JobStatus) {
  return prisma.job.update({ where: { id }, data: { status } });
}

export function setAppMap(id: string, appMap: AppMap) {
  return prisma.job.update({ where: { id }, data: { appMap: toDatabaseJson(appMap), status: 'planning' } });
}

export function setTestPlan(id: string, testPlan: TestPlan) {
  return prisma.job.update({ where: { id }, data: { testPlan: toDatabaseJson(testPlan), status: 'generating' } });
}

export function completeJob(id: string) {
  return prisma.job.update({ where: { id }, data: { status: 'completed', completedAt: new Date() } });
}

export function failJob(id: string, errorCode: string, errorMessage: string) {
  return prisma.job.update({ where: { id }, data: { status: 'failed', errorCode, errorMessage, completedAt: new Date() } });
}

export async function getJobById(id: string) {
  try {
    return await prisma.job.findUnique({
      where: { id },
      include: {
        agentSteps: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        generatedTests: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { executionResults: { orderBy: { attemptNumber: 'asc' } } },
        },
      },
    });
  } catch (cause) {
    throw new DatabaseError(cause);
  }
}

export type LoadedJob = NonNullable<Awaited<ReturnType<typeof getJobById>>>;

export async function listJobs(page: number, limit: number) {
  try {
    const [rows, total] = await Promise.all([
      prisma.job.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true, targetUrl: true, status: true, createdAt: true, completedAt: true,
          _count: { select: { generatedTests: true } },
        },
      }),
      prisma.job.count(),
    ]);
    const counts = rows.length === 0 ? [] : await prisma.generatedTest.groupBy({
      by: ['jobId', 'finalStatus'],
      where: { jobId: { in: rows.map((job) => job.id) } },
      _count: { _all: true },
    });
    const jobs = rows.map(({ _count, ...job }) => {
      const count = (status: string) => counts.find((c) => c.jobId === job.id && c.finalStatus === status)?._count._all ?? 0;
      return { ...job, testCount: _count.generatedTests, passedCount: count('passed'), failedCount: count('failed'), gaveUpCount: count('gave_up') };
    });
    return { jobs, total, page, totalPages: Math.ceil(total / limit) };
  } catch (cause) {
    throw new DatabaseError(cause);
  }
}

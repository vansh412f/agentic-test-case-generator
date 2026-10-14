import { crawlPage } from '../crawler/pageCrawler.ts';
import { planTests } from './steps/planner.ts';
import { generateTest } from './steps/generator.ts';
import type { GeneratedTest } from './steps/generator.ts';
import type { AppMap, InteractiveElement } from '../crawler/types.ts';
import type { TestPlan } from './prompts/plannerPrompt.ts';
import type { ScopedElement } from './types.ts';

export type { GeneratedTest };

export interface PipelineResult {
  appMap: AppMap;
  testPlan: TestPlan;
  generatedTests: GeneratedTest[];
}

function buildTargetUrl(baseUrl: string, targetPage: string): string {
  if (targetPage.startsWith('http://') || targetPage.startsWith('https://')) {
    return targetPage;
  }
  try {
    return new URL(targetPage, baseUrl).href;
  } catch {
    return baseUrl;
  }
}

function projectElementScope(elements: InteractiveElement[]): ScopedElement[] {
  return elements.map(({ id, type, text, selectors }) => ({
    id,
    type,
    text: text ?? null,
    selectors,
  }));
}

export async function runPipeline(url: string): Promise<PipelineResult> {
  const appMap = await crawlPage(url);

  const testPlan = await planTests(appMap);

  const generatedTests: GeneratedTest[] = [];

  for (const testCase of testPlan.testCases) {
    // Slice App Map elements to only those referenced by this test case
    const referencedIds = new Set(
      testCase.steps
        .map((step) => step.elementId)
        .filter((id): id is string => id !== null),
    );

    const elementsInScope = projectElementScope(
      appMap.elements.filter((elem) => referencedIds.has(elem.id)),
    );

    const targetUrl = buildTargetUrl(appMap.url, testCase.targetPage);

    const generated = await generateTest(testCase, elementsInScope, targetUrl);
    generatedTests.push(generated);
  }

  return { appMap, testPlan, generatedTests };
}

import { runPipeline } from '../src/agent/pipeline.ts';

async function main() {
  const url = process.argv[2] || 'https://example.com';
  console.log(`\n=== Pipeline E2E Test ===`);
  console.log(`Target URL: ${url}\n`);

  try {
    const result = await runPipeline(url);

    console.log(`--- App Map ---`);
    console.log(`Interactive elements: ${result.appMap.elements.length}`);

    console.log(`\n--- Test Plan ---`);
    console.log(`Test cases: ${result.testPlan.testCases.length}`);
    for (const tc of result.testPlan.testCases) {
      console.log(`  [${tc.id}] ${tc.title} (${tc.steps.length} steps) → ${tc.targetPage}`);
    }

    console.log(`\n--- Generated Tests ---`);
    console.log(`Files: ${result.generatedTests.length}`);
    for (const gt of result.generatedTests) {
      console.log(`\n  ${gt.filename} (${gt.code.length} chars)`);
      console.log(`  Preview: ${gt.code.slice(0, 150)}...`);
    }

    console.log(`\n Pipeline completed successfully.`);
  } catch (err) {
    console.error(`\n Pipeline failed:`);
    console.error(err);
  }
}

main();

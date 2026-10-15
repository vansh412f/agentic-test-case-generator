import { runPipeline } from '../src/agent/pipeline.ts';

async function main() {
  const url = process.argv[2] || 'https://example.com';
  console.log(`\n=== Pipeline E2E Test ===`);
  console.log(`Target URL: ${url}\n`);

  try {
    const result = await runPipeline(url);

    console.log(`--- App Map ---`);
    console.log(`Interactive elements: ${result.appMap.elements.length}`);

    console.log(`\n--- Test Plan JSON ---`);
    console.log(JSON.stringify(result.testPlan, null, 2));

    console.log(`\n--- Generated Tests ---`);
    console.log(`Files: ${result.generatedTests.length}`);
    for (const gt of result.generatedTests) {
      console.log(`\n=== ${gt.filename} ===`);
      console.log(gt.code);
    }

    console.log(`\n--- Pipeline Summary ---`);
    for (const gt of result.generatedTests) {
      console.log(`${gt.testCaseId} | ${gt.status} | attempts=${gt.attempts.length}`);
      for (const attempt of gt.attempts) {
        const n = attempt.attemptNumber;
        const corrected = attempt.corrected;
        const validate = attempt.validationPassed ? 'PASS' : 'FAIL';
        let execute = '-';
        if (attempt.executionPassed === true) {
          execute = 'PASS';
        } else if (attempt.executionPassed === false) {
          execute = 'FAIL';
        }
        const failureClass = attempt.failureClass ?? '-';
        let firstErrorLine = '';
        if (attempt.validationErrors && attempt.validationErrors.length > 0) {
          firstErrorLine = attempt.validationErrors[0].split(/\r?\n/)[0] || '';
        } else if (attempt.executionError) {
          firstErrorLine = attempt.executionError.split(/\r?\n/)[0] || '';
        }
        const errSuffix = firstErrorLine ? ` ${firstErrorLine}` : '';
        console.log(`  #${n} corrected=${corrected} validate=${validate} execute=${execute} class=${failureClass}${errSuffix}`);
      }
    }

    console.log(`\n Pipeline completed successfully.`);
  } catch (err) {
    console.error(`\n Pipeline failed:`);
    console.error(err);
  }
}

main();

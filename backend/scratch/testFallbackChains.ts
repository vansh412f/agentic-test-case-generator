import assert from 'node:assert/strict';
import {
  parseModelChain,
  getModelsFor,
  modelFor,
  GROQ_DEFAULT_REASONING_CHAIN,
  GROQ_DEFAULT_FAST_CHAIN,
  GEMINI_DEFAULT_REASONING_CHAIN,
  GEMINI_DEFAULT_FAST_CHAIN,
} from '../src/llm/providers.config.ts';
import { openAiCompatibleChat } from '../src/llm/providers/openAiCompatible.ts';
import { callLlm } from '../src/llm/client.ts';
import { LlmError } from '../src/llm/types.ts';
import { withRequestLlmKeys } from '../src/llm/requestKeys.ts';

async function runTests() {
  console.log('=== RUNNING FALLBACK CHAINS & ROUTING VERIFICATION SUITE ===');

  // ---------------------------------------------------------------------------
  // 1. parseModelChain unit tests
  // ---------------------------------------------------------------------------
  console.log('\n--- 1. parseModelChain Unit Tests ---');
  {
    // 1a. Plural string splits, trims, and limits to 3
    const parsedPlural = parseModelChain('model-a, model-b , model-c, model-d', undefined, ['default-1']);
    assert.deepEqual(parsedPlural, ['model-a', 'model-b', 'model-c'], 'Must parse, trim, and cap plural list at 3');

    // 1b. Singular string used if plural is empty or undefined
    const parsedSingular = parseModelChain(undefined, 'custom-singular', ['default-1', 'default-2']);
    assert.deepEqual(parsedSingular, ['custom-singular'], 'Must use custom singular when plural is missing');

    // 1c. Default chain used when neither plural nor custom singular provided
    const parsedDefault = parseModelChain(undefined, undefined, ['default-1', 'default-2']);
    assert.deepEqual(parsedDefault, ['default-1', 'default-2'], 'Must use default chain when neither provided');

    // 1d. Whitespace-only values ignored
    const parsedWhitespace = parseModelChain('   ', '   ', ['default-1']);
    assert.deepEqual(parsedWhitespace, ['default-1'], 'Must treat whitespace-only as undefined');

    console.log('  PASS: parseModelChain logic verified (plural cap, singular fallback, default fallback, whitespace)');
  }

  // ---------------------------------------------------------------------------
  // 2. getModelsFor and modelFor defaults
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Default Model Chains ---');
  {
    const groqReasoning = getModelsFor('groq', 'reasoning');
    const groqFast = getModelsFor('groq', 'fast');
    const geminiReasoning = getModelsFor('gemini', 'reasoning');
    const geminiFast = getModelsFor('gemini', 'fast');

    assert.deepEqual(groqReasoning, GROQ_DEFAULT_REASONING_CHAIN, 'Groq reasoning default chain matches');
    assert.deepEqual(groqFast, GROQ_DEFAULT_FAST_CHAIN, 'Groq fast default chain matches');
    assert.deepEqual(geminiReasoning, GEMINI_DEFAULT_REASONING_CHAIN, 'Gemini reasoning default chain matches');
    assert.deepEqual(geminiFast, GEMINI_DEFAULT_FAST_CHAIN, 'Gemini fast default chain matches');

    assert.equal(modelFor('groq', 'reasoning'), groqReasoning[0], 'modelFor groq reasoning returns primary');
    assert.equal(modelFor('groq', 'fast'), groqFast[0], 'modelFor groq fast returns primary');
    assert.equal(modelFor('gemini', 'reasoning'), geminiReasoning[0], 'modelFor gemini reasoning returns primary');
    assert.equal(modelFor('gemini', 'fast'), geminiFast[0], 'modelFor gemini fast returns primary');

    // Verify deprecated gemini-2.5-flash-lite is NOT in the active fast chain
    assert.ok(!geminiFast.includes('gemini-2.5-flash-lite'), 'gemini-2.5-flash-lite must not be in active fast chain');
    assert.equal(geminiFast[0], 'gemini-3.5-flash-lite', 'gemini-3.5-flash-lite must be primary fast model');

    console.log('  PASS: Default model chains and primary models verified');
  }

  // ---------------------------------------------------------------------------
  // 3. MODEL_UNAVAILABLE Error Classification in openAiCompatible
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. MODEL_UNAVAILABLE Error Classification ---');
  const originalFetch = globalThis.fetch;
  try {
    // 3a. 404 HTTP status
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: 'This model models/gemini-2.5-flash-lite is no longer available to new users.',
            code: 404,
          },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () => {
        await openAiCompatibleChat({
          providerName: 'gemini',
          endpointUrl: 'https://mock.gemini/chat',
          apiKey: 'mock-key',
          defaultModel: 'gemini-2.5-flash-lite',
          request: { messages: [{ role: 'user', content: 'test' }] },
          signal: new AbortController().signal,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof LlmError, 'Must be instance of LlmError');
        assert.equal(err.code, 'MODEL_UNAVAILABLE', '404 must be classified as MODEL_UNAVAILABLE');
        return true;
      },
    );

    // 3b. 400 HTTP status with decommissioned/not found message
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: 'The model `llama-old` has been decommissioned and is no longer available.',
            code: 'model_decommissioned',
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () => {
        await openAiCompatibleChat({
          providerName: 'groq',
          endpointUrl: 'https://mock.groq/chat',
          apiKey: 'mock-key',
          defaultModel: 'llama-old',
          request: { messages: [{ role: 'user', content: 'test' }] },
          signal: new AbortController().signal,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof LlmError, 'Must be instance of LlmError');
        assert.equal(err.code, 'MODEL_UNAVAILABLE', 'Decommissioned model 400 must be classified as MODEL_UNAVAILABLE');
        return true;
      },
    );

    console.log('  PASS: MODEL_UNAVAILABLE correctly classified for 404 and decommissioned 400');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // 4. In-Provider Fallback Chain Execution in callLlm
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. In-Provider Fallback Chain Execution ---');
  try {
    const calledModels: string[] = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      calledModels.push(body.model);

      // Fail primary model with 404 MODEL_UNAVAILABLE
      if (body.model === 'openai/gpt-oss-120b') {
        return new Response(
          JSON.stringify({ error: { message: 'model_not_found: openai/gpt-oss-120b' } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Fallback model succeeds
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok": true}' } }],
          model: body.model,
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch;

    const response = await withRequestLlmKeys({ groq: 'test-groq-key' }, async () => {
      return callLlm({
        messages: [{ role: 'user', content: 'hello' }],
        tier: 'reasoning',
        task: 'plan-core',
      });
    });

    assert.equal(response.content, '{"ok": true}', 'Fallback model must succeed');
    assert.deepEqual(
      calledModels,
      ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
      'Must call primary model first, then advance immediately to fallback model upon MODEL_UNAVAILABLE',
    );

    console.log('  PASS: In-provider fallback advance from 120b -> qwen3.8-27b verified');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // 5. Cross-Provider Fallback When All Models Fail
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Cross-Provider Fallback Execution ---');
  try {
    const calledEndpoints: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const body = JSON.parse(String(init?.body || '{}'));
      calledEndpoints.push(`${urlStr}:${body.model}`);

      // All Groq models return 404
      if (urlStr.includes('api.groq.com')) {
        return new Response(
          JSON.stringify({ error: { message: `model_not_found: ${body.model}` } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Gemini fallback succeeds
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"gemini": true}' } }],
          model: body.model,
          usage: { prompt_tokens: 15, completion_tokens: 15 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch;

    const response = await withRequestLlmKeys(
      { groq: 'test-groq-key', gemini: 'test-gemini-key' },
      async () => {
        return callLlm({
          messages: [{ role: 'user', content: 'cross-provider test' }],
          tier: 'reasoning',
          task: 'plan-single',
        });
      },
    );

    assert.equal(response.content, '{"gemini": true}', 'Gemini provider must succeed after Groq models exhausted');
    assert.ok(
      calledEndpoints.some((e) => e.includes('api.groq.com')),
      'Groq must have been attempted first',
    );
    assert.ok(
      calledEndpoints.some((e) => e.includes('googleapis.com')),
      'Gemini must have been attempted after Groq exhausted',
    );

    console.log('  PASS: Cross-provider fallback after Groq chain exhaustion verified');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n=== ALL FALLBACK CHAIN VERIFICATION TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch((err) => {
  console.error('\nFAIL: Fallback chain verification failed:', err);
  process.exit(1);
});

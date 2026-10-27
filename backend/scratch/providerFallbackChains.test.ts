import assert from 'node:assert/strict';
import {
  parseModelChain,
  getModelsFor,
  modelFor,
  GROQ_DEFAULT_REASONING_CHAIN,
  GROQ_DEFAULT_FAST_CHAIN,
  GEMINI_DEFAULT_REASONING_CHAIN,
  GEMINI_DEFAULT_FAST_CHAIN,
  LLM_MAX_RETRIES_PER_PROVIDER,
} from '../src/llm/providers.config.ts';
import { openAiCompatibleChat } from '../src/llm/providers/openAiCompatible.ts';
import { callLlm } from '../src/llm/client.ts';
import { LlmError } from '../src/llm/types.ts';
import { withRequestLlmKeys } from '../src/llm/requestKeys.ts';

async function runTests() {
  console.log('=== RUNNING FALLBACK CHAINS & ROUTING VERIFICATION SUITE ===');

  // ---------------------------------------------------------------------------
  // 1. parseModelChain unit tests (R2 / C2)
  // ---------------------------------------------------------------------------
  console.log('\n--- 1. parseModelChain Unit Tests (R2 / C2) ---');
  {
    // 1a. Plural string splits, trims, DE-DUPLICATES, and limits to 3
    const parsedPlural = parseModelChain(
      'model-a, model-b, model-a, model-c, model-d',
      undefined,
      ['default-1'],
    );
    assert.deepEqual(
      parsedPlural,
      ['model-a', 'model-b', 'model-c'],
      'Must parse, trim, de-duplicate, and cap plural list at 3',
    );

    // 1b. Singular string prepends as primary and de-duplicates with default fallbacks, cap 3
    const parsedSingularCustom = parseModelChain(
      undefined,
      'custom-singular',
      ['default-1', 'default-2'],
    );
    assert.deepEqual(
      parsedSingularCustom,
      ['custom-singular', 'default-1', 'default-2'],
      'Must prepend custom singular as primary and retain default fallbacks',
    );

    const parsedSingularReprioritize = parseModelChain(
      undefined,
      'default-2',
      ['default-1', 'default-2', 'default-3'],
    );
    assert.deepEqual(
      parsedSingularReprioritize,
      ['default-2', 'default-1', 'default-3'],
      'Must reprioritize singular from default chain to primary without duplicate',
    );

    // 1c. Default chain used when neither plural nor custom singular provided
    const parsedDefault = parseModelChain(undefined, undefined, ['default-1', 'default-2']);
    assert.deepEqual(parsedDefault, ['default-1', 'default-2'], 'Must use default chain when neither provided');

    // 1d. Whitespace-only values ignored
    const parsedWhitespace = parseModelChain('   ', '   ', ['default-1', 'default-2']);
    assert.deepEqual(parsedWhitespace, ['default-1', 'default-2'], 'Must treat whitespace-only as undefined');

    console.log('  PASS: parseModelChain logic verified (plural dedupe/cap, singular reprioritize, default, whitespace)');
  }

  // ---------------------------------------------------------------------------
  // 2. Default Model Chains (R3 / C3)
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Default Model Chains (R3 / C3) ---');
  {
    const groqReasoning = getModelsFor('groq', 'reasoning');
    const groqFast = getModelsFor('groq', 'fast');
    const geminiReasoning = getModelsFor('gemini', 'reasoning');
    const geminiFast = getModelsFor('gemini', 'fast');

    assert.deepEqual(groqReasoning, GROQ_DEFAULT_REASONING_CHAIN, 'Groq reasoning default chain matches');
    assert.deepEqual(groqReasoning, ['openai/gpt-oss-120b'], 'Groq reasoning has Qwen removed');
    assert.deepEqual(groqFast, GROQ_DEFAULT_FAST_CHAIN, 'Groq fast default chain matches');
    assert.deepEqual(geminiReasoning, GEMINI_DEFAULT_REASONING_CHAIN, 'Gemini reasoning default chain matches');
    assert.deepEqual(geminiFast, GEMINI_DEFAULT_FAST_CHAIN, 'Gemini fast default chain matches');
    assert.deepEqual(geminiFast, ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'], 'Gemini fast chain swapped 3.1 primary');

    assert.equal(modelFor('groq', 'reasoning'), 'openai/gpt-oss-120b', 'modelFor groq reasoning returns primary');
    assert.equal(modelFor('groq', 'fast'), 'openai/gpt-oss-20b', 'modelFor groq fast returns primary');
    assert.equal(modelFor('gemini', 'reasoning'), 'gemini-3.5-flash', 'modelFor gemini reasoning returns primary');
    assert.equal(modelFor('gemini', 'fast'), 'gemini-3.1-flash-lite', 'modelFor gemini fast returns primary');

    // Verify deprecated gemini-2.5-flash-lite is NOT in the active fast chain
    assert.ok(!geminiFast.includes('gemini-2.5-flash-lite'), 'gemini-2.5-flash-lite must not be in active fast chain');

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
  // 4. MODEL_UNAVAILABLE Advances Model in Same Provider Chain
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. MODEL_UNAVAILABLE Advances Model in Same Provider Chain ---');
  try {
    const calledModels: string[] = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      calledModels.push(body.model);

      // Fail primary fast model on Groq with 404 MODEL_UNAVAILABLE
      if (body.model === 'openai/gpt-oss-20b') {
        return new Response(
          JSON.stringify({ error: { message: 'model_not_found: openai/gpt-oss-20b' } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Secondary fast model succeeds
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
        tier: 'fast',
        task: 'generate',
      });
    });

    assert.equal(response.content, '{"ok": true}', 'Fallback model must succeed');
    assert.deepEqual(
      calledModels,
      ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
      'Must call primary model first, then advance to fallback model on MODEL_UNAVAILABLE',
    );

    console.log('  PASS: In-provider fallback advance on MODEL_UNAVAILABLE verified');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // 5. BAD_RESPONSE Advances to Next Provider Without Touching Model 2 (R1 / C1)
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. BAD_RESPONSE Advances to Next Provider Immediately (R1 / C1) ---');
  try {
    const calledCalls: Array<{ url: string; model: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const body = JSON.parse(String(init?.body || '{}'));
      calledCalls.push({ url: urlStr, model: body.model });

      // Groq model 1 returns BAD_RESPONSE (422 Unprocessable Entity)
      if (urlStr.includes('api.groq.com')) {
        return new Response(
          JSON.stringify({ error: { message: 'Unprocessable entity' } }),
          { status: 422, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Gemini provider succeeds
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"from_gemini": true}' } }],
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
          messages: [{ role: 'user', content: 'test bad response' }],
          tier: 'fast',
          task: 'generate',
        });
      },
    );

    assert.equal(response.content, '{"from_gemini": true}', 'Must succeed on Gemini');
    // Must NOT touch Groq model 2 (qwen/qwen3.8-27b)
    const groqCalls = calledCalls.filter((c) => c.url.includes('api.groq.com'));
    assert.equal(groqCalls.length, 1, 'Groq must be called exactly once before failing over to Gemini');
    assert.equal(groqCalls[0].model, 'openai/gpt-oss-20b', 'Only primary model was called on Groq');
    assert.ok(
      !calledCalls.some((c) => c.model === 'qwen/qwen3.8-27b'),
      'Must NOT touch secondary model on Groq when BAD_RESPONSE occurs',
    );

    console.log('  PASS: BAD_RESPONSE goes to next provider without touching model 2');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // 6. Long RATE_LIMITED (>10s) Advances to Next Provider Immediately (R1 / C1)
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Long RATE_LIMITED (>10s) Advances to Next Provider Immediately (R1 / C1) ---');
  try {
    const calledCalls: Array<{ url: string; model: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const body = JSON.parse(String(init?.body || '{}'));
      calledCalls.push({ url: urlStr, model: body.model });

      // Groq returns 429 with retry-after > 10s
      if (urlStr.includes('api.groq.com')) {
        return new Response(
          JSON.stringify({ error: { message: 'Rate limit exceeded' } }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'retry-after': '15',
            },
          },
        );
      }

      // Gemini provider succeeds
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"gemini_fast": true}' } }],
          model: body.model,
          usage: { prompt_tokens: 12, completion_tokens: 12 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch;

    const response = await withRequestLlmKeys(
      { groq: 'test-groq-key', gemini: 'test-gemini-key' },
      async () => {
        return callLlm({
          messages: [{ role: 'user', content: 'test rate limit' }],
          tier: 'fast',
          task: 'generate',
        });
      },
    );

    assert.equal(response.content, '{"gemini_fast": true}', 'Must succeed on Gemini');
    const groqCalls = calledCalls.filter((c) => c.url.includes('api.groq.com'));
    assert.equal(groqCalls.length, 1, 'Groq must be called once and failover immediately on long 429');
    assert.equal(groqCalls[0].model, 'openai/gpt-oss-20b', 'Groq primary model only');

    console.log('  PASS: Long RATE_LIMITED (>10s) goes to next provider without touching model 2');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // 7. Retry Exhaustion Advances to Next Provider (R1 / C1)
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Retry Exhaustion Advances to Next Provider (R1 / C1) ---');
  try {
    let groqAttempts = 0;
    const calledModels: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const body = JSON.parse(String(init?.body || '{}'));
      calledModels.push(body.model);

      // Groq returns retryable 503 with short backoff (attempt 0, 1)
      if (urlStr.includes('api.groq.com')) {
        groqAttempts++;
        return new Response(
          JSON.stringify({ error: { message: 'Service unavailable' } }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Gemini provider succeeds
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"gemini_after_exhaustion": true}' } }],
          model: body.model,
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch;

    const response = await withRequestLlmKeys(
      { groq: 'test-groq-key', gemini: 'test-gemini-key' },
      async () => {
        return callLlm({
          messages: [{ role: 'user', content: 'test retry exhaustion' }],
          tier: 'fast',
          task: 'generate',
        });
      },
    );

    assert.equal(response.content, '{"gemini_after_exhaustion": true}', 'Must succeed on Gemini');
    // LLM_MAX_RETRIES_PER_PROVIDER is 2, so initial (0) + retries (1, 2) = 3 total attempts
    assert.equal(groqAttempts, LLM_MAX_RETRIES_PER_PROVIDER + 1, 'Groq must be retried up to LLM_MAX_RETRIES_PER_PROVIDER');
    assert.ok(
      !calledModels.includes('qwen/qwen3.8-27b'),
      'Must NOT advance to Groq model 2 after retry exhaustion; must advance to next provider',
    );

    console.log('  PASS: Retry exhaustion advances to next provider without touching model 2');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // 8. AUTH_FAILED Skips Provider Remaining Models (R1 / C1)
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. AUTH_FAILED Skips Provider Remaining Models (R1 / C1) ---');
  try {
    const calledModels: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const body = JSON.parse(String(init?.body || '{}'));
      calledModels.push(`${urlStr}:${body.model}`);

      // Groq returns 401 Invalid API Key
      if (urlStr.includes('api.groq.com')) {
        return new Response(
          JSON.stringify({ error: { message: 'Invalid API Key' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Gemini provider succeeds
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"gemini_auth_fallback": true}' } }],
          model: body.model,
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch;

    const response = await withRequestLlmKeys(
      { groq: 'bad-key', gemini: 'test-gemini-key' },
      async () => {
        return callLlm({
          messages: [{ role: 'user', content: 'test auth failure' }],
          tier: 'fast',
          task: 'generate',
        });
      },
    );

    assert.equal(response.content, '{"gemini_auth_fallback": true}', 'Must succeed on Gemini');
    const groqCalls = calledModels.filter((m) => m.includes('api.groq.com'));
    assert.equal(groqCalls.length, 1, 'Groq must only be called once');
    assert.ok(
      !calledModels.some((m) => m.includes('qwen/qwen3.8-27b')),
      'Must NOT attempt model 2 on Groq when AUTH_FAILED occurs',
    );

    console.log('  PASS: AUTH_FAILED skips remaining models of provider and advances to next provider');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ---------------------------------------------------------------------------
  // 9. request.modelOverride behaves as 1-element chain (R1 / C1)
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. request.modelOverride Behaves as 1-Element Chain (R1 / C1) ---');
  try {
    const calledModels: string[] = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      calledModels.push(body.model);

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"override": true}' } }],
          model: body.model,
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch;

    const response = await withRequestLlmKeys({ groq: 'test-groq-key' }, async () => {
      return callLlm({
        messages: [{ role: 'user', content: 'test override' }],
        modelOverride: 'custom-single-model',
        tier: 'fast',
      });
    });

    assert.equal(response.content, '{"override": true}', 'Override model must succeed');
    assert.deepEqual(calledModels, ['custom-single-model'], 'Must call exactly the override model');

    console.log('  PASS: request.modelOverride single-element chain verified');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n=== ALL FALLBACK CHAIN VERIFICATION TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch((err) => {
  console.error('\nFAIL: Fallback chain verification failed:', err);
  process.exit(1);
});

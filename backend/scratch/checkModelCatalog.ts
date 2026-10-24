import dotenv from 'dotenv';
dotenv.config();

import { getModelsFor } from '../src/llm/providers.config.ts';
import { openAiCompatibleChat } from '../src/llm/providers/openAiCompatible.ts';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const SPOT_CHECK_MODELS = [
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
];

interface ModelCatalogResult {
  provider: string;
  allModels: string[];
  chatModels: string[];
}

async function fetchGroqCatalog(): Promise<ModelCatalogResult> {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set in environment');
  }
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq models list failed (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as { data: Array<{ id: string }> };
  const allModels = data.data.map((m) => m.id).sort();
  // Filter out audio, whisper, embeddings, guard models if recognizable
  const chatModels = allModels.filter(
    (id) =>
      !id.includes('whisper') &&
      !id.includes('embed') &&
      !id.includes('guard') &&
      !id.includes('tts'),
  );
  return { provider: 'groq', allModels, chatModels };
}

async function fetchGeminiCatalog(): Promise<ModelCatalogResult> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in environment');
  }
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', {
    headers: {
      Authorization: `Bearer ${GEMINI_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini models list failed (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as { data: Array<{ id: string }> };
  const allModels = data.data.map((m) => m.id.replace(/^models\//, '')).sort();
  // Filter out embeddings, imagen, text-embedding, aqa
  const chatModels = allModels.filter(
    (id) =>
      !id.includes('embedding') &&
      !id.includes('imagen') &&
      !id.includes('aqa') &&
      !id.includes('tts'),
  );
  return { provider: 'gemini', allModels, chatModels };
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSmokeForModel(
  provider: 'groq' | 'gemini',
  model: string,
  endpoint: string,
  apiKey: string,
) {
  console.log(`\n  [SMOKE] Testing ${provider}:${model}...`);
  try {
    const started = Date.now();
    const res = await openAiCompatibleChat({
      providerName: provider,
      endpointUrl: endpoint,
      apiKey,
      defaultModel: model,
      model,
      request: {
        messages: [{ role: 'user', content: 'Output JSON: {"smoke": "ok"}' }],
        maxTokens: 500,
        responseFormat: 'json_object',
      },
      signal: AbortSignal.timeout(30000),
    });
    console.log(
      `  [SMOKE PASS] ${provider}:${model} in ${Date.now() - started}ms: ${res.content.trim()} (in=${res.usage?.promptTokens}, out=${res.usage?.completionTokens})`,
    );
  } catch (err) {
    console.error(
      `  [SMOKE FAIL] ${provider}:${model}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function main() {
  const isSmoke = process.argv.includes('--smoke');
  console.log('=== CHECK MODEL CATALOG ===');
  console.log(`Mode: ${isSmoke ? 'SMOKE TEST (--smoke)' : 'CATALOG DISCOVERY (0 LLM completion calls)'}\n`);

  let groqCatalog: ModelCatalogResult | null = null;
  let geminiCatalog: ModelCatalogResult | null = null;

  try {
    groqCatalog = await fetchGroqCatalog();
    console.log(`[Groq Catalog] Total: ${groqCatalog.allModels.length}, Chat-Capable: ${groqCatalog.chatModels.length}`);
    console.log('Chat-capable models on Groq:');
    groqCatalog.chatModels.forEach((m) => console.log(`  - ${m}`));
  } catch (err) {
    console.error(`[Groq Catalog Error] ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log('');

  try {
    geminiCatalog = await fetchGeminiCatalog();
    console.log(`[Gemini Catalog] Total: ${geminiCatalog.allModels.length}, Chat-Capable: ${geminiCatalog.chatModels.length}`);
    console.log('Chat-capable models on Gemini:');
    geminiCatalog.chatModels.forEach((m) => console.log(`  - ${m}`));
  } catch (err) {
    console.error(`[Gemini Catalog Error] ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log('\n--- VERIFYING CONFIGURED MODEL CHAINS ---');

  const chains: Array<{
    provider: 'groq' | 'gemini';
    tier: 'reasoning' | 'fast';
    catalog: ModelCatalogResult | null;
  }> = [
    { provider: 'groq', tier: 'reasoning', catalog: groqCatalog },
    { provider: 'groq', tier: 'fast', catalog: groqCatalog },
    { provider: 'gemini', tier: 'reasoning', catalog: geminiCatalog },
    { provider: 'gemini', tier: 'fast', catalog: geminiCatalog },
  ];

  let primaryMissing = false;
  let fallbackMissing = false;

  for (const c of chains) {
    const configuredModels = getModelsFor(c.provider, c.tier);
    console.log(`\nChain: ${c.provider.toUpperCase()} (${c.tier}) -> [${configuredModels.join(', ')}]`);
    const available = new Set(c.catalog?.allModels ?? []);

    configuredModels.forEach((m, idx) => {
      const isPrimary = idx === 0;
      const found = available.has(m) || available.has(`models/${m}`);
      const status = found ? 'FOUND' : 'MISSING';
      const role = isPrimary ? 'PRIMARY' : `FALLBACK ${idx}`;
      console.log(`  ${status.padEnd(8)} [${role}]: ${m}`);
      if (!found) {
        if (isPrimary) {
          primaryMissing = true;
        } else {
          fallbackMissing = true;
        }
      }
    });
  }

  console.log('\n--- SPOT-CHECK CANDIDATE MODELS PRESENCE ---');
  if (geminiCatalog) {
    const geminiAvailable = new Set(geminiCatalog.allModels);
    for (const model of SPOT_CHECK_MODELS) {
      const present = geminiAvailable.has(model) || geminiAvailable.has(`models/${model}`);
      console.log(`  ${model.padEnd(25)}: ${present ? 'PRESENT' : 'ABSENT'}`);
    }
  }

  if (isSmoke) {
    console.log('\n--- RUNNING SMOKE CHECKS ON CHAIN PRIMARIES ---');
    const groqReasoningPrimary = getModelsFor('groq', 'reasoning')[0];
    const groqFastPrimary = getModelsFor('groq', 'fast')[0];
    const geminiReasoningPrimary = getModelsFor('gemini', 'reasoning')[0];
    const geminiFastPrimary = getModelsFor('gemini', 'fast')[0];

    if (GROQ_API_KEY) {
      await runSmokeForModel('groq', groqReasoningPrimary, 'https://api.groq.com/openai/v1/chat/completions', GROQ_API_KEY);
      await sleep(15000);
      if (groqFastPrimary !== groqReasoningPrimary) {
        await runSmokeForModel('groq', groqFastPrimary, 'https://api.groq.com/openai/v1/chat/completions', GROQ_API_KEY);
        await sleep(15000);
      }
    }

    if (GEMINI_API_KEY) {
      await runSmokeForModel('gemini', geminiReasoningPrimary, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', GEMINI_API_KEY);
      await sleep(15000);
      if (geminiFastPrimary !== geminiReasoningPrimary) {
        await runSmokeForModel('gemini', geminiFastPrimary, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', GEMINI_API_KEY);
      }
    }
  }

  console.log('\n--- CATALOG CHECK SUMMARY ---');
  if (primaryMissing) {
    console.error('ERROR: One or more PRIMARY models are MISSING in provider catalog!');
    process.exit(1);
  }
  if (fallbackMissing) {
    console.warn('WARNING: One or more FALLBACK models are missing in catalog (exit 0).');
  } else {
    console.log('SUCCESS: All configured chain models FOUND in catalogs.');
  }
}

main().catch((err) => {
  console.error('Fatal error checking catalogs:', err);
  process.exit(1);
});

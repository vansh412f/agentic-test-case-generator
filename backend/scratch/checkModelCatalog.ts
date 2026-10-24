import dotenv from 'dotenv';
dotenv.config();

import { openAiCompatibleChat } from '../src/llm/providers/openAiCompatible.ts';

const THINKING_MODELS = [
  { provider: 'groq' as const, model: 'openai/gpt-oss-120b', url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY! },
  { provider: 'groq' as const, model: 'openai/gpt-oss-20b', url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY! },
  { provider: 'gemini' as const, model: 'gemini-3.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: process.env.GEMINI_API_KEY! },
  { provider: 'gemini' as const, model: 'gemini-3-flash-preview', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: process.env.GEMINI_API_KEY! },
  { provider: 'gemini' as const, model: 'gemini-2.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: process.env.GEMINI_API_KEY! },
];

async function main() {
  console.log('=== Testing with maxTokens: 500 ===');
  for (const item of THINKING_MODELS) {
    try {
      const started = Date.now();
      const res = await openAiCompatibleChat({
        providerName: item.provider,
        endpointUrl: item.url,
        apiKey: item.key,
        defaultModel: item.model,
        model: item.model,
        request: {
          messages: [{ role: 'user', content: 'Say hello in one word.' }],
          maxTokens: 500,
        },
        signal: AbortSignal.timeout(30000),
      });
      console.log(`[PASS] ${item.provider}:${item.model} (${Date.now() - started}ms): "${res.content.trim()}" (promptTokens=${res.usage?.promptTokens}, completionTokens=${res.usage?.completionTokens})`);
    } catch (err) {
      console.log(`[FAIL] ${item.provider}:${item.model}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise(r => setTimeout(r, 15000));
  }
}

main().catch(console.error);

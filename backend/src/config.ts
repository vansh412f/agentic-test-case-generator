import dotenv from 'dotenv';
import { z } from 'zod';
import { LLM_PROVIDER_ORDER, type LlmProviderName } from './llm/providers.config.ts';

dotenv.config();

const configSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HEADLESS: z
    .string()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true'),
  MAX_ELEMENTS_PER_PAGE: z.coerce.number().int().positive().default(200),
  NAVIGATION_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  NETWORK_IDLE_WAIT_MS: z.coerce.number().int().nonnegative().default(3000),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

const parseConfig = (): Config => {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }

  return result.data;
};

export const config: Config = parseConfig();
export const VIEWPORT = { width: 1280, height: 720 } as const;

// Maps provider names to their corresponding config properties
export const PROVIDER_ENV_KEYS: Record<LlmProviderName, keyof Config> = {
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

const activeProviders: LlmProviderName[] = [];
const missingProviders: LlmProviderName[] = [];

for (const provider of LLM_PROVIDER_ORDER) {
  const key = PROVIDER_ENV_KEYS[provider];
  const value = config[key];

  if (typeof value === 'string' && value.trim().length > 0) {
    activeProviders.push(provider);
  } else {
    missingProviders.push(provider);
  }
}

// Fail fast on boot if no API keys are provided for the configured chain
if (activeProviders.length === 0) {
  console.error('\n No LLM provider API keys configured.');
  console.error(`LLM_PROVIDER_ORDER contains: ${LLM_PROVIDER_ORDER.join(', ')}`);
  console.error('Configure at least one in your .env file:\n');
  for (const provider of LLM_PROVIDER_ORDER) {
    console.error(`  ${PROVIDER_ENV_KEYS[provider].padEnd(16)}`);
  }
  console.error('');
  process.exit(1);
}

if (missingProviders.length > 0) {
  for (const provider of missingProviders) {
    console.warn(`${PROVIDER_ENV_KEYS[provider]} is missing — fallback provider "${provider}" will be skipped.`);
  }
}

export { activeProviders, missingProviders };
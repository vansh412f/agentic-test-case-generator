import dotenv from 'dotenv';
import { z } from 'zod';
import { LLM_PROVIDER_ORDER, type LlmProviderName } from './llm/providers.config.ts';

dotenv.config();

if (process.env.HEADLESS === 'false') {
  console.warn(
    '[Config] HEADLESS is no longer read; browsers run headless. Set HEADED_DEBUG=true to watch them.',
  );
}

const configSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HEADED_DEBUG: z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() === 'true'),
  CRAWL_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  MAX_ELEMENTS_PER_PAGE: z.coerce.number().int().positive().default(200),
  NAVIGATION_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  NETWORK_IDLE_WAIT_MS: z.coerce.number().int().nonnegative().default(3000),
  DATABASE_URL: z.string().trim().min(1),
  DIRECT_URL: z.string().trim().min(1),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_REASONING_MODEL: z.string().default('openai/gpt-oss-120b'),
  GROQ_FAST_MODEL: z.string().default('openai/gpt-oss-20b'),
  GEMINI_REASONING_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_FAST_MODEL: z.string().default('gemini-2.5-flash-lite'),
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_MODEL: z.string().default('openai/gpt-oss-20b'),
  LLM_PROVIDER_ORDER: z.string().default('groq,gemini,nvidia'),
  POW_SECRET: z.string().min(16).optional(),
  VISITOR_SIGNING_SECRET: z.string().min(16).optional(),
  GENERATE_DAILY_LIMIT: z.coerce.number().int().positive().default(40),
  FREE_VISITOR_DAILY_LIMIT: z.coerce.number().int().positive().default(8),
  FREE_IP_DAILY_LIMIT: z.coerce.number().int().positive().default(20),
  FREE_MAX_URLS_PER_RUN: z.coerce.number().int().positive().default(3),
  BYOK_MAX_URLS_PER_RUN: z.coerce.number().int().positive().default(5),
  CRAWL_DAILY_LIMIT_PER_IP: z.coerce.number().int().positive().default(40),
  POW_DAILY_LIMIT_PER_IP: z.coerce.number().int().positive().default(200),
  BYOK_VALIDATE_DAILY_LIMIT_PER_IP: z.coerce.number().int().positive().default(50),
  PIPELINE_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  QUEUE_MAX_WAITING_GROUPS: z.coerce.number().int().min(1).default(5),
  BASELINE_TESTS: z.string().default('true').transform((v) => v.toLowerCase() === 'true'),
  A11Y_SMOKE: z.string().default('true').transform((v) => v.toLowerCase() === 'true'),
  WAKING_HOST_SUFFIXES: z
    .string()
    .default('onrender.com,koyeb.app,up.railway.app,fly.dev,hf.space,glitch.me,replit.app'),
  LOCAL_AGENT_MODE: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  FRONTEND_ORIGIN: z.string().optional(),
  JOB_TOKEN_BUDGET: z.coerce.number().int().min(0).default(40000),
});

export type Config = z.infer<typeof configSchema> & {
  HEADLESS: boolean;
};

const parseConfig = (): Config => {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }

  if (result.data.NODE_ENV === 'production' && result.data.HEADED_DEBUG) {
    console.warn('[Config] HEADED_DEBUG=true is ignored in production; browsers always run headless.');
  }

  const headless = result.data.NODE_ENV === 'production' ? true : !result.data.HEADED_DEBUG;

  return { ...result.data, HEADLESS: headless };
};

export const config: Config = parseConfig();

if (!config.VISITOR_SIGNING_SECRET && config.NODE_ENV === 'production') {
  console.warn(
    '[Security] VISITOR_SIGNING_SECRET is not set. Falling back to DATABASE_URL hash. Rotating DB credentials will invalidate active visitor sessions.'
  );
}

export const VIEWPORT = { width: 1280, height: 720 } as const;

// Maps provider names to their corresponding config properties
export const PROVIDER_ENV_KEYS: Record<LlmProviderName, keyof Config> = {
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
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

// Allow BYOK-only deployments to boot without environment keys
if (activeProviders.length === 0) {
  console.warn('\n[Warning] No LLM provider API keys configured in environment.');
  console.warn(`LLM_PROVIDER_ORDER contains: ${LLM_PROVIDER_ORDER.join(', ')}`);
  console.warn('Default runs will fail unless users supply request keys (BYOK).\n');
}

if (missingProviders.length > 0) {
  for (const provider of missingProviders) {
    console.warn(`${PROVIDER_ENV_KEYS[provider]} is missing — fallback provider "${provider}" will be skipped.`);
  }
}

export function getActiveProviders(): LlmProviderName[] {
  const active: LlmProviderName[] = [];
  for (const provider of LLM_PROVIDER_ORDER) {
    const key = PROVIDER_ENV_KEYS[provider];
    const value = config[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      active.push(provider);
    }
  }
  return active;
}

export { activeProviders, missingProviders };
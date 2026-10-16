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
  DATABASE_URL: z.string().trim().min(1),
  DIRECT_URL: z.string().trim().min(1),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  POW_SECRET: z.string().min(16).optional(),
  VISITOR_SIGNING_SECRET: z.string().min(16).optional(),
  GENERATE_DAILY_LIMIT: z.coerce.number().int().positive().default(20),
  LOCAL_AGENT_MODE: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  FRONTEND_ORIGIN: z.string().optional(),
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

export { activeProviders, missingProviders };
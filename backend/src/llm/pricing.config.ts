import { GEMINI_DEFAULT_MODEL, GROQ_DEFAULT_MODEL } from './providers.config.ts';

export interface ModelPricing {
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
}

// USD per 1M tokens, keyed by the model id recorded in AgentStep.llmModel.
// Groq rate is the list price for openai/gpt-oss-120b — verify against
// groq.com/pricing before relying on estimates. Gemini is priced at 0
// because the project runs on the free tier; moving to a paid Gemini tier
// is a change here, not in the estimator.
export const MODEL_PRICING_USD_PER_MILLION: Readonly<Record<string, ModelPricing>> = {
  [GROQ_DEFAULT_MODEL]: { promptUsdPerMillion: 0.15, completionUsdPerMillion: 0.6 },
  [GEMINI_DEFAULT_MODEL]: { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
};

import { toast } from 'sonner';
import { ApiError, errorDetail } from './api';

export interface HandleGenerationErrorOptions {
  onQuota?: (details: { limit: number; resetsAt?: string }) => void;
}

export function handleGenerationError(
  error: unknown,
  options?: HandleGenerationErrorOptions,
): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RATE_LIMITED': {
        const retryAfter = errorDetail(error, 'retryAfterSeconds');
        const wait =
          retryAfter !== undefined
            ? ` Please retry in ${retryAfter}s.`
            : ' Please slow down.';
        const msg = `Rate limit reached.${wait}`;
        toast.error(msg);
        return msg;
      }

      case 'DAILY_QUOTA_EXHAUSTED': {
        const limit = errorDetail(error, 'limit');
        const resetsAt = errorDetail(error, 'resetsAt');
        options?.onQuota?.({
          limit: typeof limit === 'number' ? limit : 20,
          resetsAt: typeof resetsAt === 'string' ? resetsAt : undefined,
        });
        const msg = 'The free daily demo quota is exhausted. Add your own API key to continue.';
        toast.error(msg);
        return msg;
      }

      case 'QUEUE_FULL': {
        const msg = 'The demo server is currently running at maximum capacity. Please retry shortly.';
        toast.error(msg);
        return msg;
      }

      case 'POW_FAILED': {
        const msg = 'Bot verification failed. Please try again.';
        toast.error(msg);
        return msg;
      }

      case 'INVALID_API_KEY': {
        const provider = errorDetail(error, 'provider');
        const providerName =
          provider === 'groq' ? 'Groq' : provider === 'gemini' ? 'Gemini' : 'API';
        const msg = `Your ${providerName} key was rejected. Open API Keys to fix it.`;
        toast.error(msg);
        return msg;
      }

      case 'UPSTREAM_UNAVAILABLE':
      case 'BROWSER_LAUNCH_FAILED': {
        const msg = error.message;
        toast.error(msg);
        return msg;
      }

      default: {
        const msg = error.message || 'Generation failed.';
        toast.error(msg);
        return msg;
      }
    }
  }

  const msg = error instanceof Error ? error.message : 'Generation failed.';
  toast.error(msg);
  return msg;
}

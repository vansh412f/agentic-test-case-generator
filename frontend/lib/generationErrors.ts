import { toast } from 'sonner';
import { ApiError, errorDetail, errorDetailRaw } from './api';

function formatLocalResetTime(iso?: string): string {
  if (!iso) return 'midnight UTC';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export interface HandleGenerationErrorOptions {
  onQuota?: (details: { limit: number; resetsAt?: string; scope?: string }) => void;
}

export function handleGenerationError(
  error: unknown,
  options?: HandleGenerationErrorOptions,
): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RATE_LIMITED': {
        const resetsAt = errorDetail(error, 'resetsAt');
        const localTime = formatLocalResetTime(typeof resetsAt === 'string' ? resetsAt : undefined);
        const msg = `Daily limit reached. Resets at ${localTime}.`;
        toast.error(msg);
        return msg;
      }

      case 'DAILY_QUOTA_EXHAUSTED': {
        const scope = errorDetail(error, 'scope') as string | undefined;
        const limit = errorDetail(error, 'limit');
        const resetsAt = errorDetail(error, 'resetsAt');
        const limitNum = typeof limit === 'number' ? limit : 8;
        const isoReset = typeof resetsAt === 'string' ? resetsAt : undefined;
        const localTime = formatLocalResetTime(isoReset);

        options?.onQuota?.({
          limit: limitNum,
          resetsAt: isoReset,
          scope,
        });

        let prefix = "Today's free demo capacity is used up.";
        if (scope === 'visitor') {
          prefix = `You've used all ${limitNum} free runs for today.`;
        } else if (scope === 'ip') {
          prefix = `This network has used all ${limitNum} free runs for today.`;
        }

        const msg = `${prefix} Resets at ${localTime}. Add your own free Groq key for unlimited runs.`;
        toast.error(msg);
        return msg;
      }

      case 'ALREADY_RUNNING': {
        const rawJobIds = errorDetailRaw(error, 'jobIds');
        const firstJobId =
          Array.isArray(rawJobIds) && typeof rawJobIds[0] === 'string'
            ? rawJobIds[0]
            : null;
        const msg = 'You already have a run in progress';
        if (firstJobId) {
          toast.error(msg, {
            action: {
              label: 'View job',
              onClick: () => {
                window.location.href = `/jobs/${firstJobId}`;
              },
            },
          });
        } else {
          toast.error(msg);
        }
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

      case 'SERVICE_UNAVAILABLE': {
        const msg = error.message || 'Usage tracking is temporarily unavailable. Please retry shortly.';
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

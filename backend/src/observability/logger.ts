import winston from 'winston';

/**
 * Sensitive string patterns redaction helper.
 */
export function redactString(val: string): string {
  return val
    // Bearer auth tokens
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    // Groq API keys
    .replace(/gsk_[A-Za-z0-9_-]{20,}/gi, 'gsk_[REDACTED]')
    // Gemini API keys
    .replace(/AIzaSy[A-Za-z0-9_-]{20,}/g, 'AIzaSy[REDACTED]')
    // Database connection URLs
    .replace(/postgres(?:ql)?:\/\/[^\s"'`<>]+/gi, 'postgresql://[REDACTED]')
    // Signed trace token (epoch.hmac)
    .replace(/\b\d{13}\.[A-Za-z0-9_-]{32,}\b/g, '[TRACE_TOKEN_REDACTED]')
    // Query param trace token: ?t=... or &t=...
    .replace(/([?&]t=)[A-Za-z0-9_.-]+/gi, '$1[REDACTED]');
}

const SENSITIVE_KEYS = new Set([
  'authorization',
  'apikey',
  'api_key',
  'token',
  'secret',
  'password',
  'database_url',
  'direct_url',
  'pow_secret',
  'visitor_signing_secret',
  'admin_secret',
  'cookie',
]);

/**
 * Recursively redacts sensitive keys and values in log payloads.
 */
export function redactPayload(key: string, value: unknown): unknown {
  if (typeof key === 'string' && SENSITIVE_KEYS.has(key.toLowerCase())) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (value instanceof Error) {
    return {
      message: redactString(value.message),
      name: value.name,
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map((v) => redactPayload('', v));
    }
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      sanitized[k] = redactPayload(k, v);
    }
    return sanitized;
  }
  return value;
}

const redactFormat = winston.format((info) => {
  if (typeof info.message === 'string') {
    info.message = redactString(info.message);
  }
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'timestamp') continue;
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      info[key] = '[REDACTED]';
    } else {
      info[key] = redactPayload(key, info[key]);
    }
  }
  return info;
});

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  redactFormat(),
  winston.format.json()
);

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  redactFormat(),
  winston.format.colorize(),
  winston.format.printf((info) => {
    const { timestamp, level, message, component, jobId, provider, model, latencyMs, ...rest } = info;
    const compTag = component ? `[${component}]` : '';
    const jobTag = jobId ? `[job=${jobId}]` : '';
    const providerTag = provider ? `[${provider}${model ? `/${model}` : ''}]` : '';
    const latencyTag = latencyMs !== undefined ? `(${latencyMs}ms)` : '';
    const tags = [compTag, jobTag, providerTag, latencyTag].filter(Boolean).join(' ');
    const tagPrefix = tags ? ` ${tags}` : '';
    
    // Remaining metadata excluding symbols
    const cleanRest: Record<string, unknown> = {};
    for (const key of Object.keys(rest)) {
      cleanRest[key] = rest[key];
    }
    const metaKeys = Object.keys(cleanRest);
    const metaStr = metaKeys.length > 0 ? ` ${JSON.stringify(cleanRest)}` : '';

    return `${timestamp} ${level}:${tagPrefix} ${message}${metaStr}`;
  })
);

export interface LogContext {
  component?: string;
  jobId?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  errorCode?: string;
  [key: string]: unknown;
}

export const logger = winston.createLogger({
  level: logLevel,
  format: isProduction ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
    }),
  ],
});

export function childLogger(context: LogContext): winston.Logger {
  return logger.child(context);
}

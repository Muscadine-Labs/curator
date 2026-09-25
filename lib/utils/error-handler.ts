/**
 * Standardized Error Handling Utilities
 */

import { logger } from './logger';

interface ApiError {
  message: string;
  code?: string;
  statusCode: number;
  details?: unknown;
}

export class AppError extends Error {
  statusCode: number;
  code?: string;
  details?: unknown;

  constructor(message: string, statusCode: number = 500, code?: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** Server-only values that must never appear in a response body. */
const SECRET_ENV_KEYS = [
  'ALCHEMY_API_KEY',
  'COINBASE_CDP_API_KEY',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'CURATOR_ADMIN_PASSWORD',
  'CURATOR_OWNER_PASSWORD',
  'CURATOR_SESSION_SECRET',
] as const;

/**
 * Message safe to return to the browser for an unexpected error. viem errors
 * embed the RPC request URL — which carries the server Alchemy / CDP key — in
 * `message`, so prefer `shortMessage`, keep only the first line, drop URLs,
 * and scrub any configured secret that still slips through.
 */
export function publicErrorMessage(error: unknown, fallback: string): string {
  let text = '';
  if (error && typeof error === 'object' && 'shortMessage' in error) {
    const short = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof short === 'string') text = short;
  }
  if (!text && error instanceof Error) text = error.message;
  text = (text.split('\n')[0] ?? '').replace(/https?:\/\/\S+/g, '[url]');
  for (const key of SECRET_ENV_KEYS) {
    const secret = process.env[key]?.trim();
    if (secret && secret.length >= 6) text = text.split(secret).join('[redacted]');
  }
  return text.trim() || fallback;
}

/**
 * Create a standardized API error response
 */
function createErrorResponse(
  error: unknown,
  defaultMessage: string = 'An error occurred'
): { error: ApiError; statusCode: number } {
  if (error instanceof AppError) {
    return {
      error: {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        details: error.details,
      },
      statusCode: error.statusCode,
    };
  }

  if (error instanceof Error) {
    return {
      error: {
        message: publicErrorMessage(error, defaultMessage),
        statusCode: 500,
      },
      statusCode: 500,
    };
  }

  return {
    error: {
      message: defaultMessage,
      statusCode: 500,
    },
    statusCode: 500,
  };
}

/**
 * Handle API route errors consistently
 */
export function handleApiError(error: unknown, defaultMessage?: string) {
  const { error: apiError, statusCode } = createErrorResponse(error, defaultMessage);
  
  // Log the original error (full message + stack) server-side only.
  logger.error('API Error', error instanceof Error ? error : new Error(apiError.message), {
    code: apiError.code,
    statusCode: apiError.statusCode,
    details: apiError.details,
  });

  return {
    error: apiError,
    statusCode,
  };
}





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
        message: error.message || defaultMessage,
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
  
  // Log error
  logger.error('API Error', new Error(apiError.message), {
    code: apiError.code,
    statusCode: apiError.statusCode,
    details: apiError.details,
  });

  return {
    error: apiError,
    statusCode,
  };
}





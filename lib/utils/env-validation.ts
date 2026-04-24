/**
 * Environment Variable Validation
 * Validates required environment variables at startup
 */

import { logger } from './logger';

interface EnvValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate required environment variables
 */
function validateEnvVars(): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required public environment variables
  if (!process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID) {
    if (process.env.NODE_ENV === 'production') {
      errors.push('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required in production');
    } else {
      warnings.push('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set (using demo mode)');
    }
  }

  // At least one RPC provider must be configured
  const hasAlchemyKey = !!(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || process.env.ALCHEMY_API_KEY);
  const hasCoinbaseKey = !!process.env.COINBASE_CDP_API_KEY;
  
  if (!hasAlchemyKey && !hasCoinbaseKey) {
    warnings.push('No RPC API key configured (ALCHEMY_API_KEY or COINBASE_CDP_API_KEY). Using demo endpoints (rate limited)');
  }

  // Server-side RPC key recommended
  if (!process.env.ALCHEMY_API_KEY && !process.env.COINBASE_CDP_API_KEY) {
    warnings.push('No server-side RPC API key configured. Server-side calls will use demo endpoints');
  }

  // Client-side RPC key recommended
  if (!process.env.NEXT_PUBLIC_ALCHEMY_API_KEY) {
    warnings.push('NEXT_PUBLIC_ALCHEMY_API_KEY is not set. Client-side RPC calls will use demo endpoints');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Log environment variable validation results
 */
export function logEnvValidation(): void {
  const result = validateEnvVars();

  if (result.errors.length > 0) {
    logger.error('Environment variable validation failed', new Error('Missing required environment variables'), {
      errors: result.errors,
    });
  }

  if (result.warnings.length > 0) {
    result.warnings.forEach((warning) => {
      logger.warn(warning);
    });
  }

  if (result.isValid && result.warnings.length === 0) {
    logger.info('Environment variables validated successfully');
  }
}


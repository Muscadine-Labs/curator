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

  if (!process.env.ALCHEMY_API_KEY?.trim()) {
    warnings.push('ALCHEMY_API_KEY is not set. Server RPC falls back to https://mainnet.base.org');
  }

  if (!process.env.NEXT_PUBLIC_ALCHEMY_API_KEY?.trim()) {
    warnings.push('NEXT_PUBLIC_ALCHEMY_API_KEY is not set. Client wallet RPC uses public chain endpoints');
  }

  const isProductionRuntime =
    process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build';

  if (!process.env.NEXT_PUBLIC_SAFE_API_KEY?.trim()) {
    warnings.push(
      'NEXT_PUBLIC_SAFE_API_KEY is not set. /curator/gates cannot list whitelist calls from the Curator and Allocator Safes'
    );
  }

  if (isProductionRuntime && !process.env.CURATOR_ADMIN_PASSWORD?.trim()) {
    errors.push('CURATOR_ADMIN_PASSWORD is required in production');
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


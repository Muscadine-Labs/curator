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
    warnings.push('No RPC API key configured (ALCHEMY_API_KEY or COINBASE_CDP_API_KEY). Server RPC falls back to https://mainnet.base.org');
  }

  // Server-side RPC key recommended
  if (!process.env.ALCHEMY_API_KEY && !process.env.COINBASE_CDP_API_KEY) {
    warnings.push('No server-side RPC API key configured. Server-side calls use https://mainnet.base.org');
  }

  // Client-side RPC key recommended
  if (!process.env.NEXT_PUBLIC_ALCHEMY_API_KEY) {
    warnings.push('NEXT_PUBLIC_ALCHEMY_API_KEY is not set. Client wallet RPC uses public chain endpoints');
  }

  const isProductionRuntime =
    process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build';

  if (isProductionRuntime && !process.env.CURATOR_ADMIN_PASSWORD?.trim() && !process.env.CURATOR_OWNER_PASSWORD?.trim()) {
    errors.push('CURATOR_ADMIN_PASSWORD is required in production');
  }

  if (
    isProductionRuntime &&
    (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)
  ) {
    warnings.push(
      'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN unset — login rate limits are per-instance, not global'
    );
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


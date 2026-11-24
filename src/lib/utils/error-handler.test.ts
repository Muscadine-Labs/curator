import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, handleApiError, publicErrorMessage } from './error-handler';

describe('publicErrorMessage', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('drops RPC URLs and extra lines from viem-style errors', () => {
    const error = Object.assign(
      new Error('HTTP request failed.\n\nURL: https://base-mainnet.g.alchemy.com/v2/secretkey123\nRequest body: {}'),
      { shortMessage: 'HTTP request failed.' }
    );
    expect(publicErrorMessage(error, 'fallback')).toBe('HTTP request failed.');
  });

  it('redacts configured secrets and inline URLs', () => {
    vi.stubEnv('ALCHEMY_API_KEY', 'alchemy-secret-key');
    const error = new Error('failed at https://x.io/v2/alchemy-secret-key token alchemy-secret-key');
    const message = publicErrorMessage(error, 'fallback');
    expect(message).not.toContain('alchemy-secret-key');
    expect(message).toBe('failed at [url] token [redacted]');
  });

  it('falls back when nothing is left', () => {
    expect(publicErrorMessage(new Error(''), 'fallback')).toBe('fallback');
    expect(publicErrorMessage('oops', 'fallback')).toBe('fallback');
  });
});

describe('handleApiError', () => {
  it('keeps AppError messages and status', () => {
    const { error, statusCode } = handleApiError(new AppError('Vault not found', 404, 'VAULT_NOT_FOUND'));
    expect(statusCode).toBe(404);
    expect(error.message).toBe('Vault not found');
  });
});

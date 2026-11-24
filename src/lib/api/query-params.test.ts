import { describe, expect, it } from 'vitest';
import { parseBoundedIntParam } from './query-params';

describe('parseBoundedIntParam', () => {
  const bounds = { min: 1, max: 500 };

  it('falls back for missing or non-numeric values', () => {
    expect(parseBoundedIntParam(null, 100, bounds)).toBe(100);
    expect(parseBoundedIntParam('', 100, bounds)).toBe(100);
    expect(parseBoundedIntParam('abc', 100, bounds)).toBe(100);
    expect(parseBoundedIntParam('Infinity', 100, bounds)).toBe(100);
  });

  it('clamps into range and floors fractions', () => {
    expect(parseBoundedIntParam('-5', 100, bounds)).toBe(1);
    expect(parseBoundedIntParam('9999', 100, bounds)).toBe(500);
    expect(parseBoundedIntParam('12.9', 100, bounds)).toBe(12);
    expect(parseBoundedIntParam('0', 0, { min: 0, max: 10_000 })).toBe(0);
  });
});

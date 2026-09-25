import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRecords } from './csv';

describe('parseCsv', () => {
  it('keeps newlines, commas, and escaped quotes inside quoted fields', () => {
    const text = 'name,note\r\n"Alice","line1\nline2, with ""quotes"""\nBob,plain\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Alice', 'line1\nline2, with "quotes"'],
      ['Bob', 'plain'],
    ]);
  });

  it('skips blank lines and handles a missing trailing newline', () => {
    expect(parseCsv('a,b\n\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseCsvRecords', () => {
  it('maps rows onto headers and fills missing cells', () => {
    expect(parseCsvRecords('month,revenue\n"Jan\n2026",100\nFeb')).toEqual([
      { month: 'Jan\n2026', revenue: '100' },
      { month: 'Feb', revenue: '' },
    ]);
  });

  it('returns no rows for empty input', () => {
    expect(parseCsvRecords('')).toEqual([]);
  });
});

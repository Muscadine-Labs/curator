import { describe, expect, it } from 'vitest';
import {
  activeChainlinkSource,
  isMetaOnBackup,
  type DecodedChainlinkSource,
  type MetaOracleState,
} from '@/lib/morpho/oracle-decode.server';
import { oracleTimestampFromFeeds } from '@/lib/morpho/oracle-utils';

const PRIMARY = '0x00000000000000000000000000000000000000a1';
const BACKUP = '0x00000000000000000000000000000000000000b2';

function source(address: string): DecodedChainlinkSource {
  return { address, feeds: {}, baseVault: null, quoteVault: null, priceRaw: '1' };
}

function meta(currentOracle: string | null): MetaOracleState {
  return {
    primaryOracle: PRIMARY,
    backupOracle: BACKUP,
    currentOracle,
    deviationThreshold: null,
    deviation: null,
    isChallenged: false,
    isHealing: false,
    challengeExpiresAt: null,
    healingExpiresAt: null,
    challengeTimelockDuration: null,
    healingTimelockDuration: null,
  };
}

describe('activeChainlinkSource (meta oracle)', () => {
  it('picks the source matching currentOracle', () => {
    const backup = source(BACKUP);
    expect(
      activeChainlinkSource({
        kind: 'metaOracle',
        meta: meta(BACKUP.toUpperCase().replace('0X', '0x')),
        primary: source(PRIMARY),
        backup,
      })
    ).toBe(backup);
  });

  it('never substitutes the primary when the backup is current but undecoded', () => {
    expect(
      activeChainlinkSource({
        kind: 'metaOracle',
        meta: meta(BACKUP),
        primary: source(PRIMARY),
        backup: null,
      })
    ).toBeNull();
  });

  it('defaults to primary when currentOracle is unreadable', () => {
    const primary = source(PRIMARY);
    expect(
      activeChainlinkSource({ kind: 'metaOracle', meta: meta(null), primary, backup: null })
    ).toBe(primary);
  });

  it('reports backup pricing from the meta state alone', () => {
    expect(isMetaOnBackup(meta(BACKUP))).toBe(true);
    expect(isMetaOnBackup(meta(PRIMARY))).toBe(false);
    expect(isMetaOnBackup(meta(null))).toBe(false);
  });
});

describe('oracleTimestampFromFeeds', () => {
  it('returns the stalest feed', () => {
    const r = oracleTimestampFromFeeds(
      [
        { address: '0x1', updatedAt: 900 },
        { address: '0x2', updatedAt: 500 },
        { address: '0x3', updatedAt: null },
      ],
      1000
    );
    expect(r).toEqual({ chainlinkAddress: '0x2', updatedAt: 500, ageSeconds: 500 });
  });

  it('is empty for a hardcoded oracle', () => {
    expect(oracleTimestampFromFeeds([], 1000)).toEqual({
      chainlinkAddress: null,
      updatedAt: null,
      ageSeconds: null,
    });
  });
});

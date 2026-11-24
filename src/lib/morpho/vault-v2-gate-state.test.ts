import { describe, expect, it } from 'vitest';
import {
  formatVaultGateStatus,
  vaultGateStatuses,
} from '@/lib/morpho/vault-v2-gate-state';

describe('formatVaultGateStatus', () => {
  it('labels abdicated set-gate functions even when a gate is configured', () => {
    const status = formatVaultGateStatus(
      'receiveAssets',
      '0x1111111111111111111111111111111111111111',
      [{ functionName: 'setReceiveAssetsGate', abdicatedAt: 1_700_000_000 }]
    );
    expect(status.variant).toBe('abdicated');
    expect(status.statusLabel).toBe('Abdicated');
    expect(status.address).toBe('0x1111111111111111111111111111111111111111');
  });

  it('labels an unset, non-abdicated gate as None', () => {
    const status = formatVaultGateStatus('sendAssets', '0x0000000000000000000000000000000000000000', [
      { functionName: 'setSendAssetsGate', abdicatedAt: null },
    ]);
    expect(status.variant).toBe('none');
    expect(status.statusLabel).toBe('None');
    expect(status.address).toBeNull();
  });

  it('labels a live gate as Set', () => {
    const status = formatVaultGateStatus(
      'sendAssets',
      '0xb7f2598ac79a3c6406dddb81edcc60ea72a134b9',
      [{ functionName: 'setSendAssetsGate', abdicatedAt: 0 }]
    );
    expect(status.variant).toBe('set');
    expect(status.statusLabel).toBe('Set');
  });
});

describe('vaultGateStatuses', () => {
  it('returns the four Morpho gates in overview order', () => {
    const rows = vaultGateStatuses(
      {
        receiveAssets: null,
        receiveShares: null,
        sendShares: null,
        sendAssets: null,
      },
      [
        { functionName: 'setReceiveAssetsGate', abdicatedAt: 1 },
        { functionName: 'setReceiveSharesGate', abdicatedAt: 1 },
        { functionName: 'setSendSharesGate', abdicatedAt: 1 },
        { functionName: 'setSendAssetsGate', abdicatedAt: null },
      ]
    );
    expect(rows.map((r) => r.key)).toEqual([
      'receiveAssets',
      'receiveShares',
      'sendShares',
      'sendAssets',
    ]);
    expect(rows.map((r) => r.statusLabel)).toEqual([
      'Abdicated',
      'Abdicated',
      'Abdicated',
      'None',
    ]);
  });
});

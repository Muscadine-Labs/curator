import { describe, expect, it } from 'vitest';
import { getAllVaultAddresses } from '@/lib/config/vaults';
import {
  anonymousMayRead,
  isTestingVaultPage,
  isVaultSentinelPage,
} from '@/lib/auth/public-read';

const prime = getAllVaultAddresses().find((vault) => vault.listCategory === 'prime');
const testVault = getAllVaultAddresses().find((vault) => vault.listCategory === 'test');

describe('anonymousMayRead', () => {
  it('allows overview, vault, and market reads', () => {
    expect(anonymousMayRead('GET', '/api/protocol-stats')).toBe(true);
    expect(anonymousMayRead('GET', '/api/vaults?sidebar=true')).toBe(true);
    expect(anonymousMayRead('GET', '/api/markets')).toBe(true);
    expect(anonymousMayRead('GET', '/api/markets/midnight')).toBe(true);
    expect(prime).toBeTruthy();
    expect(anonymousMayRead('GET', `/api/vaults/${prime!.address}`)).toBe(true);
    expect(anonymousMayRead('GET', `/api/vaults/${prime!.address}/risk`)).toBe(true);
    expect(anonymousMayRead('GET', `/api/vaults/${prime!.address}/reallocations`)).toBe(true);
  });

  it('keeps writes, business data, and testing vaults private', () => {
    expect(anonymousMayRead('POST', '/api/vaults')).toBe(false);
    expect(anonymousMayRead('GET', '/api/monthly-statement-morphoql')).toBe(false);
    expect(anonymousMayRead('GET', '/api/protocol-users')).toBe(false);
    expect(anonymousMayRead('GET', '/api/safe/0xabc/info')).toBe(false);
    expect(prime).toBeTruthy();
    expect(anonymousMayRead('GET', `/api/vaults/${prime!.address}/holders`)).toBe(false);
    expect(anonymousMayRead('GET', `/api/vaults/${prime!.address}/gates`)).toBe(false);
    expect(testVault).toBeTruthy();
    expect(anonymousMayRead('GET', `/api/vaults/${testVault!.address}`)).toBe(false);
    expect(anonymousMayRead('GET', `/api/vaults/${testVault!.address}/risk`)).toBe(false);
  });
});

describe('visitor page locks', () => {
  it('locks testing vault pages and sentinel', () => {
    expect(testVault).toBeTruthy();
    expect(isTestingVaultPage(`/vault/${testVault!.address}`)).toBe(true);
    expect(isTestingVaultPage(`/vault/${testVault!.address}/allocation`)).toBe(true);
    expect(prime).toBeTruthy();
    expect(isTestingVaultPage(`/vault/${prime!.address}`)).toBe(false);
    expect(isVaultSentinelPage(`/vault/${prime!.address}/sentinel`)).toBe(true);
    expect(isVaultSentinelPage(`/vault/${prime!.address}/risk`)).toBe(false);
  });
});

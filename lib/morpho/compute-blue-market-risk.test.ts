import { describe, expect, it } from 'vitest';
import {
  RISK_SCORE_CAPS,
  applyGlobalCaps,
  getMarketRiskGrade,
} from './compute-blue-market-risk';

describe('getMarketRiskGrade', () => {
  it('grades on the documented floors', () => {
    expect(getMarketRiskGrade(100)).toBe('A+');
    expect(getMarketRiskGrade(93)).toBe('A+');
    expect(getMarketRiskGrade(92.99)).toBe('A');
    expect(getMarketRiskGrade(80)).toBe('B');
    expect(getMarketRiskGrade(74)).toBe('C+');
    expect(getMarketRiskGrade(60)).toBe('D');
    expect(getMarketRiskGrade(59.99)).toBe('F');
    expect(getMarketRiskGrade(0)).toBe('F');
  });
});

describe('RISK_SCORE_CAPS', () => {
  it('caps each failing component at the grade its label names', () => {
    expect(getMarketRiskGrade(RISK_SCORE_CAPS.weakOracle)).toBe('C+');
    expect(getMarketRiskGrade(RISK_SCORE_CAPS.weakOracle + 1)).toBe('B−');
    expect(getMarketRiskGrade(RISK_SCORE_CAPS.highUtilization)).toBe('B−');
    expect(getMarketRiskGrade(RISK_SCORE_CAPS.highUtilization + 1)).toBe('B');
    expect(getMarketRiskGrade(RISK_SCORE_CAPS.partialCoverage)).toBe('B');
    expect(getMarketRiskGrade(RISK_SCORE_CAPS.partialCoverage + 1)).toBe('B+');
  });

  it('orders the caps from most to least severe', () => {
    expect(RISK_SCORE_CAPS.weakOracle).toBeLessThan(RISK_SCORE_CAPS.highUtilization);
    expect(RISK_SCORE_CAPS.highUtilization).toBeLessThan(RISK_SCORE_CAPS.partialCoverage);
  });
});

describe('applyGlobalCaps', () => {
  it('leaves a healthy market alone', () => {
    expect(applyGlobalCaps(100, 100, 100, 97)).toBe(97);
  });

  it('never raises a score that is already below a cap', () => {
    expect(applyGlobalCaps(20, 100, 100, 40)).toBe(40);
  });

  it('applies the tightest cap when several components fail', () => {
    expect(applyGlobalCaps(20, 20, 50, 95)).toBe(RISK_SCORE_CAPS.weakOracle);
    expect(applyGlobalCaps(100, 20, 50, 95)).toBe(RISK_SCORE_CAPS.highUtilization);
    expect(applyGlobalCaps(100, 100, 99.9, 95)).toBe(RISK_SCORE_CAPS.partialCoverage);
  });
});

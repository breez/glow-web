import { describe, expect, it } from 'vitest';
import {
  generatePayments,
  ScenarioPreset,
  DEFAULT_SCENARIO_CONFIG,
  validateConfig,
} from '../../e2e/utils/payment-scenario';

describe('payment scenario generator', () => {
  it('produces a reproducible default sequence', () => {
    const first = generatePayments();
    const second = generatePayments();

    expect(first).toHaveLength(DEFAULT_SCENARIO_CONFIG.paymentCount);
    expect(second).toHaveLength(DEFAULT_SCENARIO_CONFIG.paymentCount);
    expect(first).toStrictEqual(second);
  });

  it('covers edge case presets within configured bounds', () => {
    const config = {
      ...DEFAULT_SCENARIO_CONFIG,
      paymentCount: 10,
      minAmount: 100,
      maxAmount: 10_000,
    } as const;

    const payments = generatePayments(config, ScenarioPreset.EdgeCases);

    expect(payments).toHaveLength(config.paymentCount);
    payments.forEach(payment => {
      expect(payment.amountSats).toBeGreaterThanOrEqual(config.minAmount);
      expect(payment.amountSats).toBeLessThanOrEqual(config.maxAmount);
      expect(payment.delayMs).toBeGreaterThanOrEqual(config.minDelayMs);
      expect(payment.delayMs).toBeLessThanOrEqual(config.maxDelayMs);
    });
  });

  it('rejects configs that exceed the initial funding budget', () => {
    const invalid = {
      ...DEFAULT_SCENARIO_CONFIG,
      maxAmount: 20_000,
      returnInterval: 5,
    } as const;

    expect(() => validateConfig(invalid)).toThrow(/exceeds MAX_INITIAL_FUNDING/i);
  });
});

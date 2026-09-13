import { describe, it, expect } from 'vitest';
import {
  FEE_BPS,
  feeForPrice,
  formatUsd,
  parseUsdToMicros,
  splitPrice,
  stripeSurchargeFor,
  topupQuote,
  TOPUP_PACKS_MICROS,
  SANDBOX_GRANT_MICROS,
  CASH_BALANCE_CAP_MICROS,
  MICROS_PER_USD,
  toMicros,
} from '../money';

describe('money', () => {
  it('constants', () => {
    expect(FEE_BPS).toBe(50);
    expect(SANDBOX_GRANT_MICROS).toBe(25_000_000n);
    expect(CASH_BALANCE_CAP_MICROS).toBe(500_000_000n);
    expect(TOPUP_PACKS_MICROS).toEqual([20_000_000n, 50_000_000n, 100_000_000n]);
  });

  it('fee rounds up: $1.00 at 300 bps = 30000 micros, 1 micro -> 1 micro', () => {
    expect(feeForPrice(MICROS_PER_USD, 300)).toBe(30_000n);
    expect(feeForPrice(1n, 300)).toBe(1n);
    expect(feeForPrice(0n, 300)).toBe(0n);
    expect(feeForPrice(33n, 300)).toBe(1n); // 0.99 -> 1
    expect(feeForPrice(34n, 300)).toBe(2n); // 1.02 -> 2
    expect(feeForPrice(1_000_000n)).toBe(5_000n); // default FEE_BPS 50 (0.5%)
    expect(splitPrice(1_000_000n)).toEqual({ fee: 5_000n, provider: 995_000n });
  });

  it('formats and parses dollars', () => {
    expect(formatUsd(1_250_000n)).toBe('$1.25');
    expect(formatUsd('1250000')).toBe('$1.25');
    expect(formatUsd(1250000)).toBe('$1.25');
    expect(formatUsd(0n)).toBe('$0.00');
    expect(formatUsd(1n)).toBe('$0.000001');
    expect(formatUsd(-500_000n)).toBe('-$0.50');
    expect(formatUsd(1_234_567_000_000n)).toBe('$1,234,567.00');
    expect(parseUsdToMicros('$1.25')).toBe(1_250_000n);
    expect(parseUsdToMicros('1,000')).toBe(1_000_000_000n);
    expect(parseUsdToMicros('.5')).toBe(500_000n);
    expect(parseUsdToMicros(20)).toBe(20_000_000n);
    expect(() => parseUsdToMicros('abc')).toThrow();
    expect(() => parseUsdToMicros('1.1234567')).toThrow();
    expect(toMicros('42')).toBe(42n);
    expect(() => toMicros('4.2')).toThrow();
  });

  it('stripe surcharge line: 2.9% + 30c', () => {
    expect(stripeSurchargeFor(20_000_000n)).toBe(580_000n + 300_000n);
    expect(topupQuote(100_000_000n)).toEqual({ credit: 100_000_000n, surcharge: 3_200_000n, total: 103_200_000n });
    expect(() => topupQuote(1n)).toThrow();
  });
});

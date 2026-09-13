/** Platform fee in basis points, frozen onto each receipt at open */
export const FEE_BPS = 50;
export const MICROS_PER_USD = 1_000_000n;
/** Sandbox credit granted at registration: $25 */
export const SANDBOX_GRANT_MICROS = 25_000_000n;
/** Cash balance cap per agent: $500 */
export const CASH_BALANCE_CAP_MICROS = 500_000_000n;
/** Earned cash is payout-eligible after this many days */
export const PAYOUT_HOLD_DAYS = 14;
/** Top-up packs in whole dollars */
export const TOPUP_PACKS_USD = [20, 50, 100] as const;
export const TOPUP_PACKS_MICROS: readonly bigint[] = TOPUP_PACKS_USD.map(
  (d) => BigInt(d) * MICROS_PER_USD
);
/** Card processing surcharge shown on top-ups: 2.9% plus 30 cents */
export const STRIPE_SURCHARGE_BPS = 290;
export const STRIPE_SURCHARGE_FIXED_MICROS = 300_000n;

export type MicrosInput = bigint | string | number;

/**
 * Coerce a micros amount to bigint. Strings must be decimal integers; numbers must be safe integers.
 */
export function toMicros(value: MicrosInput): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`toMicros: ${value} is not a safe integer`);
    return BigInt(value);
  }
  const s = value.trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`toMicros: "${value}" is not a decimal integer`);
  return BigInt(s);
}

/**
 * ceil(price * bps / 10000)
 */
export function feeForPrice(priceMicros: bigint, feeBps: number = FEE_BPS): bigint {
  if (!Number.isInteger(feeBps) || feeBps < 0) throw new Error('feeForPrice: feeBps must be a non-negative integer');
  if (priceMicros < 0n) throw new Error('feeForPrice: price must not be negative');
  const num = priceMicros * BigInt(feeBps);
  const den = 10_000n;
  return (num + den - 1n) / den;
}

/**
 * Split a price into fee and provider share (price - fee)
 */
export function splitPrice(priceMicros: bigint, feeBps: number = FEE_BPS): { fee: bigint; provider: bigint } {
  const fee = feeForPrice(priceMicros, feeBps);
  return { fee, provider: priceMicros - fee };
}

/**
 * Format micros as a dollar string: 1250000 -> '$1.25'. Sub-cent amounts show up to 6 decimals.
 */
export function formatUsd(micros: MicrosInput): string {
  const m = toMicros(micros);
  const negative = m < 0n;
  const abs = negative ? -m : m;
  const dollars = abs / MICROS_PER_USD;
  const rem = abs % MICROS_PER_USD;
  let frac = rem.toString().padStart(6, '0');
  // Keep at least two decimals, trim trailing zeros beyond that
  frac = frac.replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  const dollarStr = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${dollarStr}.${frac}`;
}

/**
 * Parse '$1.25', '1.25', '-0.5', '1,000' into micros. Rejects more than 6 decimals.
 */
export function parseUsdToMicros(input: string | number): bigint {
  let s = typeof input === 'number' ? String(input) : input.trim();
  s = s.replace(/^\$/, '').replace(/,/g, '').replace(/^\+/, '');
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!match || (match[2] === '' && (match[3] === undefined || match[3] === ''))) {
    throw new Error(`parseUsdToMicros: "${input}" is not a dollar amount`);
  }
  const [, sign, whole = '', frac = ''] = match;
  if (frac.length > 6) throw new Error(`parseUsdToMicros: "${input}" has more than 6 decimal places`);
  const micros = BigInt(whole || '0') * MICROS_PER_USD + BigInt((frac || '').padEnd(6, '0'));
  return sign ? -micros : micros;
}

/**
 * Processing surcharge for a top-up of `amountMicros`: ceil(amount * 290 / 10000) + 300000
 */
export function stripeSurchargeFor(amountMicros: bigint): bigint {
  return feeForPrice(amountMicros, STRIPE_SURCHARGE_BPS) + STRIPE_SURCHARGE_FIXED_MICROS;
}

/**
 * True when the amount is one of the allowed top-up packs
 */
export function isTopupPack(amountMicros: bigint): boolean {
  return TOPUP_PACKS_MICROS.some((p) => p === amountMicros);
}

/**
 * The lines shown on a top-up: credit amount, surcharge and total charged to the card
 */
export function topupQuote(amountMicros: bigint): { credit: bigint; surcharge: bigint; total: bigint } {
  if (!isTopupPack(amountMicros)) throw new Error('topupQuote: amount must be a $20, $50 or $100 pack');
  const surcharge = stripeSurchargeFor(amountMicros);
  return { credit: amountMicros, surcharge, total: amountMicros + surcharge };
}

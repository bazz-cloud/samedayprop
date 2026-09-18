/**
 * Decimal-safe money.
 *
 * All monetary amounts in this system are stored and computed as integer MINOR
 * UNITS (cents for USD) using `bigint`. Binary floating point is never used for
 * money anywhere in the domain, the database, or the API surface.
 *
 * Rationale (docs/PAYOUT_AND_RISK_RULES.md §1): the payout engine performs
 * exact halving (50/50 split), percentage discounts, and repeated accumulation
 * over ledgers. IEEE-754 doubles cannot represent 0.1 exactly and accumulate
 * error, which is unacceptable for balances that back real cash obligations.
 */

export const USD = 'USD' as const;
export type Currency = typeof USD;

/** Number of minor units in one major unit, per currency. */
const MINOR_UNITS_PER_MAJOR: Record<Currency, bigint> = {
  USD: 100n,
};

export type RoundingMode =
  | 'half-up' // 0.5 rounds away from zero — default for customer-facing pricing
  | 'half-even' // banker's rounding — used where repeated allocation must not drift
  | 'floor' // toward negative infinity
  | 'ceil' // toward positive infinity
  | 'toward-zero';

export class MoneyError extends Error {}

/** Immutable monetary amount in integer minor units. */
export class Money {
  readonly minor: bigint;
  readonly currency: Currency;

  private constructor(minor: bigint, currency: Currency) {
    this.minor = minor;
    this.currency = currency;
    Object.freeze(this);
  }

  // ---------------------------------------------------------------- factories

  /** Construct from integer minor units (cents). */
  static fromMinor(minor: bigint | number, currency: Currency = USD): Money {
    if (typeof minor === 'number') {
      if (!Number.isInteger(minor)) {
        throw new MoneyError(`Money.fromMinor requires an integer, received ${minor}`);
      }
      if (!Number.isSafeInteger(minor)) {
        throw new MoneyError(`Money.fromMinor received an unsafe integer: ${minor}`);
      }
      return new Money(BigInt(minor), currency);
    }
    return new Money(minor, currency);
  }

  /**
   * Construct from a decimal STRING such as "599.00" or "-1.5".
   *
   * A string (not a number) is required so that a literal like 0.1 can never be
   * silently widened through a float. Accepts at most the currency's scale.
   */
  static parse(value: string, currency: Currency = USD): Money {
    const trimmed = value.trim().replace(/^\$/, '').replace(/,/g, '');
    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
    if (!match) {
      throw new MoneyError(`Cannot parse money from ${JSON.stringify(value)}`);
    }
    const [, sign, whole, fraction = ''] = match;
    const scale = Money.scaleOf(currency);
    if (fraction.length > scale) {
      throw new MoneyError(
        `Value ${JSON.stringify(value)} has more precision than ${currency} supports (${scale} dp)`,
      );
    }
    const padded = fraction.padEnd(scale, '0');
    const minor = BigInt(whole) * MINOR_UNITS_PER_MAJOR[currency] + BigInt(padded || '0');
    return new Money(sign ? -minor : minor, currency);
  }

  static zero(currency: Currency = USD): Money {
    return new Money(0n, currency);
  }

  /** Number of decimal places for the currency (2 for USD). */
  static scaleOf(currency: Currency): number {
    return MINOR_UNITS_PER_MAJOR[currency].toString().length - 1;
  }

  // -------------------------------------------------------------- arithmetic

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new MoneyError(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  negated(): Money {
    return new Money(-this.minor, this.currency);
  }

  abs(): Money {
    return new Money(this.minor < 0n ? -this.minor : this.minor, this.currency);
  }

  /** Multiply by an exact integer. Never introduces rounding. */
  timesInt(factor: bigint | number): Money {
    const f = typeof factor === 'number' ? BigInt(factor) : factor;
    if (typeof factor === 'number' && !Number.isInteger(factor)) {
      throw new MoneyError(`timesInt requires an integer factor, received ${factor}`);
    }
    return new Money(this.minor * f, this.currency);
  }

  /**
   * Multiply by the exact rational numerator/denominator, rounding the result
   * to whole minor units.
   *
   * A 25% discount is `mulRatio(25n, 100n)`; taking 75% of a price is
   * `mulRatio(3n, 4n)`. Using rationals rather than a float percentage is what
   * makes the published coupon prices exact (see tests/pricing.test.ts).
   */
  mulRatio(numerator: bigint, denominator: bigint, rounding: RoundingMode = 'half-up'): Money {
    if (denominator === 0n) throw new MoneyError('Division by zero in mulRatio');
    return new Money(divideRounded(this.minor * numerator, denominator, rounding), this.currency);
  }

  /** Exact halving used by the 50/50 reward split. Throws if not exact. */
  halfExact(): Money {
    if (this.minor % 2n !== 0n) {
      throw new MoneyError(
        `Cannot halve ${this.toDecimalString()} without a fractional minor unit; ` +
          'gross amounts must be constrained to an even number of minor units',
      );
    }
    return new Money(this.minor / 2n, this.currency);
  }

  /** Round DOWN to the nearest multiple of `increment` (both non-negative). */
  floorToIncrement(increment: Money): Money {
    this.assertSameCurrency(increment);
    if (increment.minor <= 0n) throw new MoneyError('Increment must be positive');
    if (this.minor <= 0n) return Money.zero(this.currency);
    return new Money(this.minor - (this.minor % increment.minor), this.currency);
  }

  isMultipleOf(increment: Money): boolean {
    this.assertSameCurrency(increment);
    if (increment.minor <= 0n) throw new MoneyError('Increment must be positive');
    return this.minor % increment.minor === 0n;
  }

  // -------------------------------------------------------------- comparison

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minor < other.minor) return -1;
    if (this.minor > other.minor) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  lt(other: Money): boolean {
    return this.compare(other) < 0;
  }
  lte(other: Money): boolean {
    return this.compare(other) <= 0;
  }
  gt(other: Money): boolean {
    return this.compare(other) > 0;
  }
  gte(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }
  isNegative(): boolean {
    return this.minor < 0n;
  }
  isPositive(): boolean {
    return this.minor > 0n;
  }

  static min(...values: Money[]): Money {
    if (values.length === 0) throw new MoneyError('Money.min requires at least one value');
    return values.reduce((a, b) => (a.lte(b) ? a : b));
  }

  static max(...values: Money[]): Money {
    if (values.length === 0) throw new MoneyError('Money.max requires at least one value');
    return values.reduce((a, b) => (a.gte(b) ? a : b));
  }

  static sum(values: Money[], currency: Currency = USD): Money {
    return values.reduce((a, b) => a.plus(b), Money.zero(currency));
  }

  // ---------------------------------------------------------------- rendering

  /** Plain decimal string without a currency symbol, e.g. "449.25", "-12.00". */
  toDecimalString(): string {
    const scale = Money.scaleOf(this.currency);
    const per = MINOR_UNITS_PER_MAJOR[this.currency];
    const negative = this.minor < 0n;
    const abs = negative ? -this.minor : this.minor;
    const whole = abs / per;
    const fraction = (abs % per).toString().padStart(scale, '0');
    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }

  /** Locale-formatted for display, e.g. "$449.25". */
  format(locale = 'en-US'): string {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
      minimumFractionDigits: Money.scaleOf(this.currency),
    });
    // Format from the decimal string to avoid a float round-trip on large values.
    return formatter.format(Number(this.toDecimalString()));
  }

  toJSON(): { minor: string; currency: Currency } {
    return { minor: this.minor.toString(), currency: this.currency };
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }
}

/** Integer division of `value / divisor` with the requested rounding mode. */
export function divideRounded(value: bigint, divisor: bigint, rounding: RoundingMode): bigint {
  if (divisor === 0n) throw new MoneyError('Division by zero');

  // Normalise so the divisor is positive; the sign rides on the numerator.
  let num = value;
  let den = divisor;
  if (den < 0n) {
    num = -num;
    den = -den;
  }

  const quotient = num / den; // truncates toward zero
  const remainder = num - quotient * den;
  if (remainder === 0n) return quotient;

  const negative = num < 0n;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;

  switch (rounding) {
    case 'toward-zero':
      return quotient;
    case 'floor':
      return negative ? quotient - 1n : quotient;
    case 'ceil':
      return negative ? quotient : quotient + 1n;
    case 'half-up': {
      if (twiceRemainder < den) return quotient;
      return negative ? quotient - 1n : quotient + 1n;
    }
    case 'half-even': {
      if (twiceRemainder < den) return quotient;
      if (twiceRemainder > den) return negative ? quotient - 1n : quotient + 1n;
      // Exactly half: move to the even neighbour.
      if (quotient % 2n === 0n) return quotient;
      return negative ? quotient - 1n : quotient + 1n;
    }
    default: {
      const exhaustive: never = rounding;
      throw new MoneyError(`Unsupported rounding mode ${String(exhaustive)}`);
    }
  }
}

/** Shorthand for USD amounts written as decimal strings: `usd('599.00')`. */
export function usd(value: string): Money {
  return Money.parse(value, USD);
}

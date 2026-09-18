/**
 * The single boundary between stored BigInt minor units and domain Money.
 *
 * Keeping the conversion in one place means a column can never be read as a
 * plain number by accident somewhere in a route handler.
 */

import { Money, USD, type Currency } from '@/domain/money/money';

export function toMoney(minor: bigint, currency: Currency = USD): Money {
  return Money.fromMinor(minor, currency);
}

export function toMinor(money: Money): bigint {
  return money.minor;
}

export function toMoneyOrNull(minor: bigint | null | undefined, currency: Currency = USD): Money | null {
  return minor === null || minor === undefined ? null : Money.fromMinor(minor, currency);
}

/**
 * Serialise Money for a JSON response.
 *
 * Both forms are sent: `minor` for any further arithmetic on the client, and
 * `display` for rendering. The client must never parse `display` back into a
 * number to compute with.
 */
export function serialiseMoney(money: Money): {
  minor: string;
  currency: string;
  decimal: string;
  display: string;
} {
  return {
    minor: money.minor.toString(),
    currency: money.currency,
    decimal: money.toDecimalString(),
    display: money.format(),
  };
}

export type SerialisedMoney = ReturnType<typeof serialiseMoney>;

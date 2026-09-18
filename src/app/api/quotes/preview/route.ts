/**
 * Price preview.
 *
 * The configurator calls this on every selection change so the figures on
 * screen always come from the server's own calculation rather than arithmetic
 * in the browser. It computes but does not persist; the durable quote is
 * created at checkout.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildQuote } from '@/domain/pricing/quote';
import { normaliseCouponCode, validateCoupon, type CouponDefinition } from '@/domain/pricing/coupon';
import { getAddOn, isAddOnKey, type AddOnKey } from '@/domain/catalog/addons';
import { isPlanKey, type PlanKey } from '@/domain/catalog/plans';
import { prisma } from '@/server/db';
import { serialiseMoney } from '@/server/money-mapper';

const BodySchema = z.object({
  planKey: z.string(),
  addOnKeys: z.array(z.string()).max(10).default([]),
  couponCode: z.string().max(64).nullable().default(null),
});

export async function POST(request: Request) {
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (!isPlanKey(parsed.planKey)) {
    return NextResponse.json({ error: 'Unknown account size.' }, { status: 400 });
  }

  const addOnKeys: AddOnKey[] = [];
  for (const key of parsed.addOnKeys) {
    if (isAddOnKey(key) && !addOnKeys.includes(key)) addOnKeys.push(key);
  }

  let coupon: CouponDefinition | null = null;
  let couponMessage: string | null = null;

  if (parsed.couponCode && parsed.couponCode.trim()) {
    const code = normaliseCouponCode(parsed.couponCode);
    const record = await prisma.coupon.findUnique({ where: { code } });
    const candidate: CouponDefinition | null = record
      ? {
          code: record.code,
          percentOff: BigInt(record.percentOff),
          scope: record.scope as CouponDefinition['scope'],
          validFrom: record.validFrom?.toISOString() ?? null,
          validUntil: record.validUntil?.toISOString() ?? null,
          maxRedemptions: record.maxRedemptions,
          maxRedemptionsPerCustomer: record.maxRedemptionsPerCustomer,
          stackable: false,
          active: record.active,
        }
      : null;

    const globalRedemptions = candidate
      ? await prisma.couponRedemption.count({ where: { coupon: { code: candidate.code } } })
      : 0;
    const eligibleItems = 1 + addOnKeys.filter((k) => getAddOn(k).couponEligible).length;

    // Per-customer usage is not checked here: a preview is unauthenticated, and
    // reporting "you already used this" to an anonymous visitor would leak
    // whether an account exists. It is enforced at order creation.
    const validation = validateCoupon(
      candidate,
      { globalRedemptions, customerRedemptions: 0 },
      new Date(),
      eligibleItems,
    );
    if (validation.ok) coupon = validation.coupon;
    else couponMessage = validation.message;
  }

  const quote = buildQuote({
    selection: { planKey: parsed.planKey as PlanKey, addOnKeys, couponCode: coupon?.code ?? null },
    coupon,
  });

  return NextResponse.json({
    lines: quote.lines.map((line) => ({
      kind: line.kind,
      itemKey: line.itemKey,
      name: line.name,
      lineSubtotal: serialiseMoney(line.lineSubtotal),
      lineDiscount: serialiseMoney(line.lineDiscount),
      lineTotal: serialiseMoney(line.lineTotal),
    })),
    subtotal: serialiseMoney(quote.subtotal),
    discountTotal: serialiseMoney(quote.discountTotal),
    taxableTotal: serialiseMoney(quote.taxableTotal),
    tax: serialiseMoney(quote.tax),
    total: serialiseMoney(quote.total),
    taxStatus: quote.taxStatus,
    taxDescription: quote.taxDescription,
    couponCode: quote.couponCode,
    couponPercentOff: quote.couponPercentOff ? Number(quote.couponPercentOff) : null,
    couponMessage,
    billingCadence: quote.billingCadence,
    productionBlockers: quote.productionBlockers,
  });
}

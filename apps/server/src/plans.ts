/**
 * Premium passes: one payment unlocks a fixed stretch, and nothing renews on
 * its own. Prices are in US cents and always come from here, never from the
 * browser. The web app shows the same table (apps/web/app/lib/pricing.ts);
 * a test keeps the two in step.
 */

export const PLAN_IDS = ['quarterly', 'half-year', 'yearly'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** How far a payment extends Premium: calendar months, then extra days. */
export type Term = { months: number; days: number };

export type PremiumPlan = {
  id: PlanId;
  name: string;
  currency: 'USD';
  amount: number;
  /** The same time at the 3-month rate; above `amount` when it is a saving. */
  compareAt: number;
  savePercent: number;
  months: number;
  bonusMonths: number;
  bonusDays: number;
  /** What a month costs, counting the bonus time. */
  perMonth: number;
  bestValue: boolean;
};

const plan = (
  id: PlanId,
  months: number,
  amount: number,
  bonus: { months?: number; days?: number } = {},
): PremiumPlan => {
  // The 3-month plan sets the base rate the longer plans are compared with.
  const compareAt = Math.round((2000 / 3) * months);
  const bonusMonths = bonus.months ?? 0;
  const bonusDays = bonus.days ?? 0;
  return {
    id,
    name: `CanvaRoom Premium · ${months} months`,
    currency: 'USD',
    amount,
    compareAt,
    // Rounded, with an exact half going down so the saving is never overstated.
    savePercent: Math.max(
      0,
      Math.ceil(((compareAt - amount) / compareAt) * 100 - 0.5),
    ),
    months,
    bonusMonths,
    bonusDays,
    perMonth: Math.round(amount / (months + bonusMonths + bonusDays / 30)),
    bestValue: id === 'yearly',
  };
};

export const PLANS: readonly PremiumPlan[] = [
  plan('quarterly', 3, 2000),
  plan('half-year', 6, 3500, { days: 15 }),
  plan('yearly', 12, 6500, { months: 1 }),
];

export const planById = (id: string | null | undefined) =>
  PLANS.find((item) => item.id === id);

export const termOfPlan = (item: PremiumPlan): Term => ({
  months: item.months + item.bonusMonths,
  days: item.bonusDays,
});

/** "6 months + 15 days free", for receipts. */
export function termLabel(item: PremiumPlan) {
  const bonus = item.bonusMonths
    ? ` + ${item.bonusMonths} month${item.bonusMonths > 1 ? 's' : ''} free`
    : item.bonusDays
      ? ` + ${item.bonusDays} days free`
      : '';
  return `${item.months} months${bonus}`;
}

/**
 * Orders made before the plans existed were for one month, and have no plan
 * recorded. Orders made since then name their plan; if the database hasn't
 * been migrated to store it yet, the amount tells the plans apart.
 */
export const PLANS_SINCE = Date.parse('2026-10-22T09:38:00Z');

export type OrderTerms = {
  plan?: string | null;
  months?: number | null;
  days?: number | null;
  amount: number;
  createdAt: string;
};

/** The plan an order was for, if it was for one of the plans. */
export function planOfOrder(order: OrderTerms) {
  if (order.plan) return planById(order.plan);
  if (Date.parse(order.createdAt) < PLANS_SINCE) return undefined;
  return PLANS.find((item) => item.amount === order.amount);
}

/** How much Premium an order buys; legacy one-month orders buy `legacyDays`. */
export function termOfOrder(order: OrderTerms, legacyDays: number): Term {
  if (order.plan && order.months != null && order.days != null)
    return { months: order.months, days: order.days };
  const item = planOfOrder(order);
  return item ? termOfPlan(item) : { months: 0, days: legacyDays };
}

/**
 * `from` (or now, if later) plus a term, counting calendar months the way
 * Postgres does: the 31st plus a month is the last day of a shorter month.
 */
export function extendBy(
  from: string | undefined,
  term: Term,
  now = Date.now(),
) {
  const start = new Date(Math.max(from ? Date.parse(from) : 0, now));
  const day = start.getUTCDate();
  const shifted = new Date(start);
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + term.months);
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return new Date(shifted.getTime() + term.days * 86_400_000).toISOString();
}

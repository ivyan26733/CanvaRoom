/**
 * Premium passes: one payment unlocks a fixed stretch, and nothing renews on
 * its own. Visitors in India pay in rupees (through Razorpay), everyone else
 * in US dollars. Prices are in the currency's smallest unit (paise, cents)
 * and always come from here, never from the browser. The web app shows the
 * same table (apps/web/app/lib/pricing.ts); a test keeps the two in step.
 */

export const PLAN_IDS = ['quarterly', 'half-year', 'yearly'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const CURRENCIES = ['USD', 'INR'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Rupees in India, going by the country Vercel's edge sets; dollars elsewhere. */
export const currencyForCountry = (
  country: string | null | undefined,
): Currency => (country?.trim().toUpperCase() === 'IN' ? 'INR' : 'USD');

/** How far a payment extends Premium: calendar months, then extra days. */
export type Term = { months: number; days: number };

export type PremiumPlan = {
  id: PlanId;
  name: string;
  currency: Currency;
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
  currency: Currency,
  id: PlanId,
  months: number,
  amount: number,
  bonus: { months?: number; days?: number } = {},
): PremiumPlan => {
  // The 3-month plan sets the base rate the longer plans are compared with.
  const compareAt = Math.round((BASE_PRICE[currency] / 3) * months);
  const bonusMonths = bonus.months ?? 0;
  const bonusDays = bonus.days ?? 0;
  return {
    id,
    name: `Avenor Premium · ${months} months`,
    currency,
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

/** What the 3-month plan costs, the base rate for the savings shown. */
const BASE_PRICE: Record<Currency, number> = { USD: 2000, INR: 49900 };

const plansIn = (
  currency: Currency,
  [quarterly, halfYear, yearly]: [number, number, number],
): readonly PremiumPlan[] => [
  plan(currency, 'quarterly', 3, quarterly),
  plan(currency, 'half-year', 6, halfYear, { days: 15 }),
  plan(currency, 'yearly', 12, yearly, { months: 1 }),
];

export const PLANS_BY_CURRENCY: Record<Currency, readonly PremiumPlan[]> = {
  USD: plansIn('USD', [2000, 3500, 6500]),
  INR: plansIn('INR', [49900, 84900, 149900]),
};

/** The dollar plans, which most of the world sees. */
export const PLANS = PLANS_BY_CURRENCY.USD;

export const isCurrency = (value: unknown): value is Currency =>
  CURRENCIES.includes(value as Currency);

export const plansFor = (currency: Currency) => PLANS_BY_CURRENCY[currency];

export const planById = (
  id: string | null | undefined,
  currency: Currency = 'USD',
) => plansFor(currency).find((item) => item.id === id);

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
  currency?: string;
  createdAt: string;
};

/** The plan an order was for, if it was for one of the plans. */
export function planOfOrder(order: OrderTerms) {
  const currency = isCurrency(order.currency) ? order.currency : 'USD';
  if (order.plan) return planById(order.plan, currency);
  if (Date.parse(order.createdAt) < PLANS_SINCE) return undefined;
  return plansFor(currency).find((item) => item.amount === order.amount);
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

/**
 * Takes a term back off an end date, for a refund: calendar months the way
 * Postgres counts them, then days, and never earlier than now.
 */
export function shortenBy(until: string, term: Term, now = Date.now()) {
  const end = new Date(Date.parse(until) - term.days * 86_400_000);
  const day = end.getUTCDate();
  const shifted = new Date(end);
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() - term.months);
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return new Date(Math.max(shifted.getTime(), now)).toISOString();
}

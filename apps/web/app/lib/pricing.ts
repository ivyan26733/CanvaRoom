/**
 * Premium passes, as the marketing pages and checkout show them. The server
 * charges from its own copy of this table (apps/server/src/plans.ts), and a
 * server test keeps the two in step. Amounts are in US cents.
 */

export type PlanId = 'quarterly' | 'half-year' | 'yearly';

export type PremiumPlan = {
  id: PlanId;
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

export const PLANS: readonly PremiumPlan[] = [
  {
    id: 'quarterly',
    amount: 2000,
    compareAt: 2000,
    savePercent: 0,
    months: 3,
    bonusMonths: 0,
    bonusDays: 0,
    perMonth: 667,
    bestValue: false,
  },
  {
    id: 'half-year',
    amount: 3500,
    compareAt: 4000,
    savePercent: 12,
    months: 6,
    bonusMonths: 0,
    bonusDays: 15,
    perMonth: 538,
    bestValue: false,
  },
  {
    id: 'yearly',
    amount: 6500,
    compareAt: 8000,
    savePercent: 19,
    months: 12,
    bonusMonths: 1,
    bonusDays: 0,
    perMonth: 500,
    bestValue: true,
  },
];

export const formatMoney = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount % 100 ? 2 : 0,
  }).format(amount / 100);

/** "$5.38", always with cents, for the price of a month. */
export const formatRate = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount / 100);

export const isPlanId = (value: unknown): value is PlanId =>
  PLANS.some((plan) => plan.id === value);

/** "6 months", "12 months". */
export const planLength = (plan: PremiumPlan) => `${plan.months} months`;

/** "+15 days free", "+1 month free", or nothing. */
export const planBonus = (plan: PremiumPlan) =>
  plan.bonusMonths
    ? `+${plan.bonusMonths} month${plan.bonusMonths > 1 ? 's' : ''} free`
    : plan.bonusDays
      ? `+${plan.bonusDays} days free`
      : '';

/** "20.00" style decimal strings for structured data. */
export const decimal = (amount: number) => (amount / 100).toFixed(2);

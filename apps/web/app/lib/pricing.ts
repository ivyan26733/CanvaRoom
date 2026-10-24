/**
 * Premium passes, as the marketing pages and checkout show them: in rupees
 * for visitors in India, in US dollars elsewhere. The server charges from its
 * own copy of this table (apps/server/src/plans.ts), and a server test keeps
 * the two in step. Amounts are in the currency's smallest unit (paise, cents).
 */

export type PlanId = 'quarterly' | 'half-year' | 'yearly';
export type Currency = 'USD' | 'INR';

export type PremiumPlan = {
  id: PlanId;
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

const QUARTERLY = { months: 3, bonusMonths: 0, bonusDays: 0 } as const;
const HALF_YEAR = { months: 6, bonusMonths: 0, bonusDays: 15 } as const;
const YEARLY = { months: 12, bonusMonths: 1, bonusDays: 0 } as const;

export const PLANS_BY_CURRENCY: Record<Currency, readonly PremiumPlan[]> = {
  USD: [
    {
      id: 'quarterly',
      currency: 'USD',
      amount: 2500,
      compareAt: 2500,
      savePercent: 0,
      ...QUARTERLY,
      perMonth: 833,
      bestValue: false,
    },
    {
      id: 'half-year',
      currency: 'USD',
      amount: 4500,
      compareAt: 5000,
      savePercent: 10,
      ...HALF_YEAR,
      perMonth: 692,
      bestValue: false,
    },
    {
      id: 'yearly',
      currency: 'USD',
      amount: 7500,
      compareAt: 10000,
      savePercent: 25,
      ...YEARLY,
      perMonth: 577,
      bestValue: true,
    },
  ],
  INR: [
    {
      id: 'quarterly',
      currency: 'INR',
      amount: 49900,
      compareAt: 49900,
      savePercent: 0,
      ...QUARTERLY,
      perMonth: 16633,
      bestValue: false,
    },
    {
      id: 'half-year',
      currency: 'INR',
      amount: 84900,
      compareAt: 99800,
      savePercent: 15,
      ...HALF_YEAR,
      perMonth: 13062,
      bestValue: false,
    },
    {
      id: 'yearly',
      currency: 'INR',
      amount: 149900,
      compareAt: 199600,
      savePercent: 25,
      ...YEARLY,
      perMonth: 11531,
      bestValue: true,
    },
  ],
};

/** The dollar plans, which most of the world sees. */
export const PLANS = PLANS_BY_CURRENCY.USD;

/** Rupees in India, going by the country Vercel's edge sets; dollars elsewhere. */
export const currencyForCountry = (
  country: string | null | undefined,
): Currency => (country?.trim().toUpperCase() === 'IN' ? 'INR' : 'USD');

const locale = (currency: Currency) => (currency === 'INR' ? 'en-IN' : 'en-US');

export const formatMoney = (amount: number, currency: Currency = 'USD') =>
  new Intl.NumberFormat(locale(currency), {
    style: 'currency',
    currency,
    maximumFractionDigits: amount % 100 ? 2 : 0,
  }).format(amount / 100);

/** "$5.38" or "₹115", for the price of a month: cents for dollars only. */
export const formatRate = (amount: number, currency: Currency = 'USD') =>
  new Intl.NumberFormat(locale(currency), {
    style: 'currency',
    currency,
    ...(currency === 'INR'
      ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
      : { minimumFractionDigits: 2 }),
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

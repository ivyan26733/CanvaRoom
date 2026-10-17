/**
 * Premium prices for the marketing pages, read on the server from the same
 * environment variables the API charges by, with the same defaults. Amounts
 * are in each currency's smallest unit (paise, cents).
 */

export type Currency = 'INR' | 'USD';

const minor = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
};

export const PRICES: Record<Currency, { amount: number; listAmount: number }> =
  {
    INR: {
      amount: minor('BILLING_INR_PRICE_MINOR', 49900),
      listAmount: minor('BILLING_INR_LIST_PRICE_MINOR', 0),
    },
    USD: {
      amount: minor('BILLING_USD_PRICE_MINOR', 1199),
      listAmount: minor('BILLING_USD_LIST_PRICE_MINOR', 1599),
    },
  };

/** Visitors in India see rupees; everyone else, dollars. */
export const currencyFor = (country: string | null | undefined): Currency =>
  country?.toUpperCase() === 'IN' ? 'INR' : 'USD';

export const formatMoney = (amount: number, currency: Currency) =>
  new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: amount % 100 ? 2 : 0,
  }).format(amount / 100);

/** "499.00" style decimal strings for structured data. */
export const decimal = (amount: number) => (amount / 100).toFixed(2);

/**
 * The Premium price for the marketing pages, read on the server from the same
 * environment variables the API charges by, with the same defaults. Amounts
 * are in US cents; everyone pays in dollars.
 */

const minor = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
};

export const PRICE = {
  amount: minor('BILLING_USD_PRICE_MINOR', 2000),
  listAmount: minor('BILLING_USD_LIST_PRICE_MINOR', 2400),
};

export const formatMoney = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount % 100 ? 2 : 0,
  }).format(amount / 100);

/** "20.00" style decimal strings for structured data. */
export const decimal = (amount: number) => (amount / 100).toFixed(2);

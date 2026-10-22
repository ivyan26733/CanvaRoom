import { billingConfigured } from './billing.js';
import type { PaymentProvider } from './models.js';
import { paypalAllowedFor } from './paypal.js';
import type { Currency } from './plans.js';

/**
 * How a visitor pays: Razorpay in rupees in India. Elsewhere PayPal, once it
 * is live (in sandbox mode, only for its testers); until then Razorpay in
 * dollars, as before.
 */
export function checkoutFor(
  currency: Currency,
  email: string | undefined,
): PaymentProvider | undefined {
  if (currency === 'USD' && paypalAllowedFor(email)) return 'paypal';
  return billingConfigured() ? 'razorpay' : undefined;
}

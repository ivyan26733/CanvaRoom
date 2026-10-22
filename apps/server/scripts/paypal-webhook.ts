// Registers the PayPal webhook for the current PAYPAL_MODE and prints its ID,
// to set as PAYPAL_WEBHOOK_ID. Needs that mode's client ID and secret in the
// environment; prints neither.
//   PAYPAL_MODE=sandbox PAYPAL_SANDBOX_CLIENT_ID=… PAYPAL_SANDBOX_CLIENT_SECRET=… \
//     npm run paypal:webhook -w @collabboard/server
import { config } from '../src/config.js';
import { PAYPAL_WEBHOOK_EVENTS, registerPayPalWebhook } from '../src/paypal.js';

if (!config.paypal)
  throw new Error(
    'Set the PayPal client ID and secret for PAYPAL_MODE (sandbox by default).',
  );
const url = `${process.env.APP_URL ?? 'https://canva-room-blush.vercel.app'}/api/billing/paypal/webhook`;
const id = await registerPayPalWebhook(url);
console.log(`Registered the ${config.paypal.mode} webhook for ${url}`);
console.log(`Events: ${PAYPAL_WEBHOOK_EVENTS.join(', ')}`);
console.log(`Set PAYPAL_WEBHOOK_ID to: ${id}`);

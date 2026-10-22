import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.js';

/**
 * Email to any address: SMTP (e.g. Gmail with an App Password), or Resend
 * with a verified sending domain.
 */
export const mailConfigured = () =>
  Boolean(config.smtp || (config.resendApiKey && config.mailDomainVerified));

/** Email to the team, which Resend's shared sender can also deliver. */
export const teamMailConfigured = () =>
  Boolean(config.smtp || config.resendApiKey);

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );

let transporter: Transporter | undefined;
const smtp = () =>
  (transporter ??= nodemailer.createTransport({
    host: config.smtp!.host,
    port: config.smtp!.port,
    secure: config.smtp!.port === 465,
    auth: { user: config.smtp!.user, pass: config.smtp!.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  }));

/** Sends one email by SMTP when set up, otherwise Resend. Throws if not accepted. */
async function send(
  to: string,
  subject: string,
  html: string,
  text: string,
  replyTo?: string,
) {
  if (config.smtp) {
    await smtp().sendMail({
      from: config.smtp.from,
      to,
      subject,
      html,
      text,
      ...(replyTo ? { replyTo } : {}),
    });
    return;
  }
  const response = await fetch(`${config.resendApiUrl}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.mailFrom,
      to: [to],
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(
      `Email was not accepted (${response.status}): ${await response.text()}`,
    );
}

/** Emails a one-time code for choosing a new password. */
export async function sendPasswordResetCode(
  to: string,
  name: string,
  code: string,
  minutes: number,
) {
  const subject = `${code} is your CanvaRoom reset code`;
  const text = `Hi ${name},\n\nYour CanvaRoom password reset code is:\n\n${code}\n\nEnter it within ${minutes} minutes to choose a new password. If it wasn't you, ignore this email. Your password stays the same.`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#141413">
  <p style="font-size:20px;font-weight:700;margin:0 0 24px">CanvaRoom</p>
  <p style="margin:0 0 16px">Hi ${escapeHtml(name)},</p>
  <p style="margin:0 0 16px">Use this code to choose a new password. It works once, for ${minutes} minutes.</p>
  <p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,monospace">${escapeHtml(code)}</p>
  <p style="margin:0;color:#57544d;font-size:14px">If it wasn’t you, ignore this email. Your password stays the same.</p>
</div>`;
  await send(to, subject, html, text);
}

/** Emails the 6-digit code that confirms a new account's address. */
export async function sendEmailVerification(
  to: string,
  name: string,
  code: string,
  minutes: number,
) {
  const subject = `${code} is your CanvaRoom verification code`;
  const text = `Hi ${name},\n\nWelcome to CanvaRoom. Your verification code is:\n\n${code}\n\nEnter it within ${minutes} minutes to confirm your email. If you didn't create this account, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#141413">
  <p style="font-size:20px;font-weight:700;margin:0 0 24px">CanvaRoom</p>
  <p style="margin:0 0 16px">Hi ${escapeHtml(name)},</p>
  <p style="margin:0 0 16px">Welcome aboard. Enter this code to confirm your email. It works once, for ${minutes} minutes.</p>
  <p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,monospace">${escapeHtml(code)}</p>
  <p style="margin:0;color:#57544d;font-size:14px">If you didn’t create this account, ignore this email.</p>
</div>`;
  await send(to, subject, html, text);
}

export type FeedbackMail = {
  email: string;
  name?: string;
  category: string;
  rating?: number;
  message: string;
  page?: string;
  account: boolean;
};

/** Sends feedback from the site to the team, replying to whoever wrote it. */
export async function sendFeedback(feedback: FeedbackMail) {
  const stars = feedback.rating
    ? `${'★'.repeat(feedback.rating)}${'☆'.repeat(5 - feedback.rating)}`
    : 'No rating';
  const from = feedback.name
    ? `${feedback.name} <${feedback.email}>`
    : feedback.email;
  const subject = `CanvaRoom feedback · ${feedback.category}${feedback.rating ? ` · ${feedback.rating}/5` : ''}`;
  const details = [
    ['From', from],
    ['Kind', feedback.category],
    ['Rating', stars],
    ['Signed in', feedback.account ? 'Yes' : 'No'],
    ...(feedback.page ? [['Page', feedback.page]] : []),
  ];
  const text = `${details.map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n${feedback.message}`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;color:#141413">
  <p style="font-size:18px;font-weight:700;margin:0 0 20px">New feedback on CanvaRoom</p>
  <table style="border-collapse:collapse;margin:0 0 20px;font-size:14px">${details
    .map(
      ([key, value]) =>
        `<tr><td style="padding:3px 16px 3px 0;color:#57544d">${escapeHtml(key!)}</td><td style="padding:3px 0">${escapeHtml(value!)}</td></tr>`,
    )
    .join('')}</table>
  <div style="white-space:pre-wrap;border-left:3px solid #ff4f1f;padding:4px 0 4px 14px;font-size:15px;line-height:1.55">${escapeHtml(feedback.message)}</div>
  <p style="margin:24px 0 0;color:#57544d;font-size:13px">Reply to this email to answer them directly.</p>
</div>`;
  await send(config.feedbackTo, subject, html, text, feedback.email);
}

/** Where customers write to us; replies to customer mail land here too. */
export const SUPPORT_EMAIL = 'canvacollabroom@gmail.com';

const PREMIUM_PERKS = [
  'Unlimited boards, and unlimited people on each one',
  'Follow-the-writer, so every screen goes where you write',
  'Export any page to PNG, SVG or PDF',
  'Images on the board to write over',
  'Session recording with voice, up to 4K',
];

export type PremiumWelcome = {
  name: string;
  /** In the currency's smallest unit (cents). */
  amount: number;
  currency: string;
  paymentId: string;
  paidUntil: string;
  appUrl: string;
};

/** The thank-you email for a Premium payment, as subject, HTML and text. */
export function premiumWelcomeEmail(welcome: PremiumWelcome) {
  const paid = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: welcome.currency,
  }).format(welcome.amount / 100);
  const until = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(welcome.paidUntil));
  const dashboard = `${welcome.appUrl}/dashboard`;
  const feedback = `${welcome.appUrl}/contact#feedback`;
  const details = [
    ['Amount paid', `${paid} ${welcome.currency}`],
    ['Payment ID', welcome.paymentId],
    ['Premium until', until],
  ];
  const subject = 'Welcome to the CanvaRoom family';
  const text = `Hi ${welcome.name},

Welcome to the CanvaRoom family, and thank you for joining Premium. Your payment went through and Premium is active on your account.

${details.map(([key, value]) => `${key}: ${value}`).join('\n')}

What Premium gives you:
${PREMIUM_PERKS.map((perk) => `- ${perk}`).join('\n')}

Open your boards: ${dashboard}

Any complaint, or a feature you'd like? Just reply to this email or write to ${SUPPORT_EMAIL}. You can also send feedback here: ${feedback}

Premium doesn't renew on its own. We'll be glad to see you renew when the month is up.

Thanks for being with us,
The CanvaRoom team`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#141413;line-height:1.55">
  <p style="font-size:20px;font-weight:700;margin:0 0 24px">CanvaRoom</p>
  <p style="font-size:22px;font-weight:700;margin:0 0 16px">Welcome to the CanvaRoom family</p>
  <p style="margin:0 0 16px">Hi ${escapeHtml(welcome.name)},</p>
  <p style="margin:0 0 20px">Thank you for joining Premium. Your payment went through and Premium is active on your account.</p>
  <table style="border-collapse:collapse;margin:0 0 24px;font-size:14px;width:100%;background:#f6f4ef;border-radius:10px">${details
    .map(
      ([key, value]) =>
        `<tr><td style="padding:10px 16px;color:#57544d">${escapeHtml(key!)}</td><td style="padding:10px 16px;font-weight:600;text-align:right">${escapeHtml(value!)}</td></tr>`,
    )
    .join('')}</table>
  <p style="margin:0 0 8px;font-weight:700">What Premium gives you</p>
  <ul style="margin:0 0 24px;padding-left:20px">${PREMIUM_PERKS.map((perk) => `<li style="margin:0 0 4px">${escapeHtml(perk)}</li>`).join('')}</ul>
  <p style="margin:0 0 28px"><a href="${escapeHtml(dashboard)}" style="display:inline-block;background:#ff4f1f;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">Open your boards</a></p>
  <p style="margin:0 0 16px">Any complaint, or a feature you’d like? Just reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#ff4f1f">${SUPPORT_EMAIL}</a>. You can also <a href="${escapeHtml(feedback)}" style="color:#ff4f1f">send us feedback</a>.</p>
  <p style="margin:0 0 24px;color:#57544d;font-size:14px">Premium doesn’t renew on its own. We’ll be glad to see you renew when the month is up.</p>
  <p style="margin:0">Thanks for being with us,<br>The CanvaRoom team</p>
</div>`;
  return { subject, html, text };
}

/** Thanks a customer for a Premium payment. */
export async function sendPremiumWelcome(to: string, welcome: PremiumWelcome) {
  const { subject, html, text } = premiumWelcomeEmail(welcome);
  await send(to, subject, html, text, SUPPORT_EMAIL);
}

import { config } from './config.js';

/** Email to any address, which needs a verified sending domain. */
export const mailConfigured = () =>
  Boolean(config.resendApiKey && config.mailDomainVerified);

/** Email to the team, which Resend's shared sender can deliver. */
export const teamMailConfigured = () => Boolean(config.resendApiKey);

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );

/** Sends one transactional email through Resend. Throws if it was not accepted. */
async function send(
  to: string,
  subject: string,
  html: string,
  text: string,
  replyTo?: string,
) {
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

export async function sendPasswordReset(
  to: string,
  name: string,
  link: string,
) {
  const subject = 'Reset your CanvaRoom password';
  const text = `Hi ${name},\n\nSomeone asked to reset the password for your CanvaRoom account. Open this link within 30 minutes to choose a new one:\n\n${link}\n\nIf it wasn't you, ignore this email. Your password stays the same.`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#141413">
  <p style="font-size:20px;font-weight:700;margin:0 0 24px">CanvaRoom</p>
  <p style="margin:0 0 16px">Hi ${escapeHtml(name)},</p>
  <p style="margin:0 0 24px">Someone asked to reset the password for your account. This link works once, for 30 minutes.</p>
  <p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#141413;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Choose a new password</a></p>
  <p style="margin:0;color:#57544d;font-size:14px">If it wasn’t you, ignore this email. Your password stays the same.</p>
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

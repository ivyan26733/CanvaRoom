import { config } from './config.js';

export const mailConfigured = () => Boolean(config.resendApiKey);

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );

/** Sends one transactional email through Resend. Throws if it was not accepted. */
async function send(to: string, subject: string, html: string, text: string) {
  const response = await fetch('https://api.resend.com/emails', {
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
    }),
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

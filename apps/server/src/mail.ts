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

// ---- The look of customer email ----
//
// Email clients drop SVG, scripts and most CSS, so the "doodles" are emoji and
// soft shapes drawn with inline-styled tables, which Gmail, Outlook and Apple
// Mail all keep.

const INK = '#141413';
const MUTED = '#57544d';
const PAPER = '#f6f4ef';
const ACCENT = '#ff4f1f';
const FONT_STACK =
  "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Thoughtful lines; one closes each email, picked by `seed` so it is stable. */
const THOUGHTS = [
  [
    'The best ideas rarely arrive alone. They show up when people draw together.',
    'Written on our whiteboard',
  ],
  [
    'A blank page is not empty. It is full of things nobody has drawn yet.',
    'Something we believe',
  ],
  [
    'Teaching is drawing a map, then handing someone the pen.',
    'Why we love classrooms',
  ],
  [
    'Messy sketches are where good thinking starts. Neat comes later.',
    'A note to ourselves',
  ],
  ['Every great diagram began as a wobbly line.', 'A note to ourselves'],
  [
    'Ideas grow faster when they have room to spread out.',
    'Why we built CanvaRoom',
  ],
] as const;

const thoughtFor = (seed: string) => {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return THOUGHTS[Math.abs(hash) % THOUGHTS.length]!;
};

/** A row of emoji doodles, spaced like stickers on a page. */
const doodles = (items: string[]) =>
  `<p style="margin:0 0 18px;font-size:26px;line-height:1;letter-spacing:10px" aria-hidden="true">${items.join('')}</p>`;

/** A dashed, hand-drawn-looking card for the main thing in an email. */
const doodleCard = (inner: string, tint = '#fff6ef', border = '#ffb59c') =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 24px;background:${tint};border:2px dashed ${border};border-radius:16px"><tr><td style="padding:20px 22px">${inner}</td></tr></table>`;

const button = (href: string, label: string) =>
  `<p style="margin:0 0 26px"><a href="${escapeHtml(href)}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:999px;box-shadow:0 3px 0 #c73a12">${label}</a></p>`;

const thoughtBlock = (seed: string) => {
  const [line, source] = thoughtFor(seed);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 24px"><tr><td style="border-left:4px solid ${ACCENT};padding:4px 0 4px 16px"><p style="margin:0 0 4px;font-size:16px;font-style:italic;color:${INK}">“${escapeHtml(line)}”</p><p style="margin:0;font-size:12px;color:${MUTED}">${escapeHtml(source)}</p></td></tr></table>`;
};
const thoughtText = (seed: string) => {
  const [line, source] = thoughtFor(seed);
  return `“${line}”\n(${source})`;
};

/**
 * The frame every customer email shares: a colour band, the wordmark with a
 * little pencil, the content, and a sign-off. `preheader` is the grey preview
 * line inbox lists show next to the subject.
 */
function frame(preheader: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${PAPER}">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #e6e2d9">
<tr><td style="height:8px;background:${ACCENT};background-image:linear-gradient(90deg,#ff4f1f,#ffb020 35%,#12a150 65%,#2d5bff);font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:30px 30px 8px;font-family:${FONT_STACK};color:${INK};line-height:1.6;font-size:15px">
<p style="margin:0 0 26px;font-size:20px;font-weight:800;letter-spacing:-0.5px">✏️ CanvaRoom</p>
${body}
</td></tr>
<tr><td style="padding:18px 30px 26px;font-family:${FONT_STACK};border-top:1px dashed #e6e2d9;color:${MUTED};font-size:12px;line-height:1.6">
Made with care for people who think out loud on a canvas. 🧡<br>
Questions? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${ACCENT}">${SUPPORT_EMAIL}</a>.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** A 6-digit code, big and spaced out, in its doodle card. */
const codeCard = (code: string, minutes: number) =>
  doodleCard(
    `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED}">Your code</p>
<p style="margin:0 0 8px;font-size:38px;font-weight:800;letter-spacing:10px;font-family:ui-monospace,Menlo,Consolas,monospace;color:${INK}">${escapeHtml(code)}</p>
<p style="margin:0;font-size:13px;color:${MUTED}">⏳ Works once, for ${minutes} minutes.</p>`,
  );

/** The password reset code email, as subject, HTML and text. */
export function passwordResetEmail(
  name: string,
  code: string,
  minutes: number,
) {
  const subject = `🔑 ${code} is your CanvaRoom reset code`;
  const text = `Hi ${name},

Forgot your password? It happens to the best of us.

Your CanvaRoom password reset code is:

    ${code}

Enter it within ${minutes} minutes to choose a new password. If this wasn't you, you can ignore this email. Your password stays exactly as it is, and your boards are safe.

${thoughtText(code)}

The CanvaRoom team`;
  const html = frame(
    `Your reset code is ${code}. It works for ${minutes} minutes.`,
    `${doodles(['🔑', '🧠', '💡'])}
<p style="margin:0 0 6px;font-size:24px;font-weight:800;letter-spacing:-0.5px">Let’s get you back in</p>
<p style="margin:0 0 18px">Hi ${escapeHtml(name)}, forgot your password? It happens to the best of us. Use this code to choose a new one.</p>
${codeCard(code, minutes)}
<p style="margin:0 0 20px;color:${MUTED};font-size:14px">🛡️ If this wasn’t you, ignore this email. Your password stays exactly as it is, and your boards are safe.</p>
${thoughtBlock(code)}
<p style="margin:0 0 6px">See you on the canvas,<br><strong>The CanvaRoom team</strong></p>`,
  );
  return { subject, html, text };
}

/** Emails a one-time code for choosing a new password. */
export async function sendPasswordResetCode(
  to: string,
  name: string,
  code: string,
  minutes: number,
) {
  const { subject, html, text } = passwordResetEmail(name, code, minutes);
  await send(to, subject, html, text);
}

/** The sign-up verification email, as subject, HTML and text. */
export function verificationEmail(name: string, code: string, minutes: number) {
  const subject = `✨ ${code} is your CanvaRoom verification code`;
  const text = `Hi ${name},

Welcome to CanvaRoom! We're so glad you're here.

Your verification code is:

    ${code}

Enter it within ${minutes} minutes to confirm your email, and your blank canvas is ready.

While you're getting settled:
- Press B on a board to open the library of formulas, tables and diagrams
- Share a board link and draw together, live, with voice
- Your first 30 minutes of active use include every feature

${thoughtText(code)}

If you didn't create this account, you can ignore this email.

The CanvaRoom team`;
  const html = frame(
    `Your code is ${code}. One step and your canvas is ready.`,
    `${doodles(['🎨', '✏️', '📐', '✨'])}
<p style="margin:0 0 6px;font-size:24px;font-weight:800;letter-spacing:-0.5px">Welcome aboard, ${escapeHtml(name)}!</p>
<p style="margin:0 0 18px">We’re so glad you’re here. One tiny step left: enter this code to confirm your email, and your blank canvas is ready.</p>
${codeCard(code, minutes)}
<p style="margin:0 0 10px;font-weight:700">While you get settled 👇</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;font-size:14px">
<tr><td style="padding:4px 10px 4px 0;vertical-align:top">📚</td><td style="padding:4px 0">Press <strong>B</strong> on a board to open the library of formulas, tables and diagrams.</td></tr>
<tr><td style="padding:4px 10px 4px 0;vertical-align:top">🤝</td><td style="padding:4px 0">Share a board link and draw together, live, with voice.</td></tr>
<tr><td style="padding:4px 10px 4px 0;vertical-align:top">⏱️</td><td style="padding:4px 0">Your first 30 minutes of active use include every feature.</td></tr>
</table>
${thoughtBlock(code)}
<p style="margin:0 0 18px;color:${MUTED};font-size:13px">Didn’t create this account? Ignore this email and nothing happens.</p>
<p style="margin:0 0 6px">Happy drawing,<br><strong>The CanvaRoom team</strong></p>`,
  );
  return { subject, html, text };
}

/** Emails the 6-digit code that confirms a new account's address. */
export async function sendEmailVerification(
  to: string,
  name: string,
  code: string,
  minutes: number,
) {
  const { subject, html, text } = verificationEmail(name, code, minutes);
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

/** "18 November 2026", in UTC like the stored end date. */
const longDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));

export type PremiumWelcome = {
  name: string;
  /** What was bought, like "6 months + 15 days free". */
  term: string;
  /** In the currency's smallest unit (cents, paise). */
  amount: number;
  currency: string;
  paymentId: string;
  paidUntil: string;
  appUrl: string;
};

/** The thank-you email for a Premium payment, as subject, HTML and text. */
export function premiumWelcomeEmail(welcome: PremiumWelcome) {
  // Rupees read as ₹7,050.00, dollars as $75.00.
  const paid = new Intl.NumberFormat(
    welcome.currency === 'INR' ? 'en-IN' : 'en-US',
    { style: 'currency', currency: welcome.currency },
  ).format(welcome.amount / 100);
  const until = longDate(welcome.paidUntil);
  const dashboard = `${welcome.appUrl}/dashboard`;
  const feedback = `${welcome.appUrl}/contact#feedback`;
  const details = [
    ['🗓️', 'Plan', `Premium, ${welcome.term}`],
    ['💳', 'Amount paid', `${paid} ${welcome.currency}`],
    ['🧾', 'Payment ID', welcome.paymentId],
    ['⭐', 'Premium until', until],
  ];
  const perkIcons = ['🏫', '👀', '📤', '🖼️', '🎬'];
  const subject = '🎉 Welcome to the CanvaRoom family';
  const text = `Hi ${welcome.name},

Welcome to the CanvaRoom family! 🎉

Thank you for joining Premium. It genuinely means a lot: every Premium pass keeps a small team building a calmer, kinder place to think and teach together. Your payment went through and Premium is active on your account right now.

${details.map(([, key, value]) => `${key}: ${value}`).join('\n')}

What you've just unlocked:
${PREMIUM_PERKS.map((perk) => `- ${perk}`).join('\n')}

Open your boards: ${dashboard}

A little idea to start with: open a fresh board, press B for the library, and sketch tomorrow's lesson or meeting before you plan it. You'll be surprised how much clearer it gets.

${thoughtText(welcome.paymentId)}

Any complaint, or a feature you'd love? Just reply to this email or write to ${SUPPORT_EMAIL}. A real person reads every message. You can also send feedback here: ${feedback}

Premium doesn't renew on its own. We'll email you a few days before it ends, so you can renew if you'd like.

With gratitude,
The CanvaRoom team`;
  const html = frame(
    `Premium is active until ${until}. Thank you for joining us!`,
    `${doodles(['🎉', '🎨', '✏️', '🚀', '✨'])}
<p style="margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-0.6px">Welcome to the CanvaRoom family</p>
<p style="margin:0 0 16px">Hi ${escapeHtml(welcome.name)},</p>
<p style="margin:0 0 22px">Thank you for joining Premium. It genuinely means a lot: every pass keeps a small team building a calmer, kinder place to think and teach together. Your payment went through and <strong>Premium is active right now</strong>.</p>
${doodleCard(
  `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED}">Your receipt</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${details
    .map(
      ([icon, key, value]) =>
        `<tr><td style="padding:6px 0;color:${MUTED}">${icon}&nbsp; ${escapeHtml(key!)}</td><td style="padding:6px 0;font-weight:700;text-align:right">${escapeHtml(value!)}</td></tr>`,
    )
    .join('')}</table>`,
)}
<p style="margin:0 0 10px;font-weight:800;font-size:16px">What you’ve just unlocked</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;font-size:14px">${PREMIUM_PERKS.map(
      (perk, index) =>
        `<tr><td style="padding:5px 12px 5px 0;vertical-align:top;font-size:18px">${perkIcons[index] ?? '✅'}</td><td style="padding:5px 0">${escapeHtml(perk)}</td></tr>`,
    ).join('')}</table>
${button(dashboard, 'Open your boards →')}
${doodleCard(
  `<p style="margin:0 0 4px;font-weight:800">💡 A little idea to start with</p>
<p style="margin:0;font-size:14px">Open a fresh board, press <strong>B</strong> for the library, and sketch tomorrow’s lesson or meeting before you plan it. You’ll be surprised how much clearer it gets.</p>`,
  '#eef6ff',
  '#9db6ff',
)}
${thoughtBlock(welcome.paymentId)}
<p style="margin:0 0 16px">Any complaint, or a feature you’d love? Just reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${ACCENT}">${SUPPORT_EMAIL}</a>. A real person reads every message. You can also <a href="${escapeHtml(feedback)}" style="color:${ACCENT}">send us feedback</a>.</p>
<p style="margin:0 0 22px;color:${MUTED};font-size:13px">Premium doesn’t renew on its own. We’ll email you a few days before it ends, so you can renew if you’d like.</p>
<p style="margin:0 0 6px">With gratitude,<br><strong>The CanvaRoom team</strong></p>`,
  );
  return { subject, html, text };
}

/** Thanks a customer for a Premium payment. */
export async function sendPremiumWelcome(to: string, welcome: PremiumWelcome) {
  const { subject, html, text } = premiumWelcomeEmail(welcome);
  await send(to, subject, html, text, SUPPORT_EMAIL);
}

export type PremiumReminderMail = {
  name: string;
  paidUntil: string;
  appUrl: string;
};

/** The heads-up a few days before Premium ends, as subject, HTML and text. */
export function premiumReminderEmail(reminder: PremiumReminderMail) {
  const until = longDate(reminder.paidUntil);
  const renew = `${reminder.appUrl}/#pricing`;
  const subject = `⏳ Your CanvaRoom Premium ends on ${until}`;
  const text = `Hi ${reminder.name},

A small heads-up: your CanvaRoom Premium ends on ${until}.

Premium doesn't renew on its own, so nothing will be charged. If you'd like to keep unlimited boards, people, exports, images and recording, you can renew for 3, 6 or 12 months here: ${renew}

Renewing adds the new time after your current end date, so you don't lose a single day.

Your boards stay yours either way. After Premium ends, the free plan keeps your first board for you to use on your own.

${thoughtText(reminder.paidUntil)}

Any question? Just reply to this email or write to ${SUPPORT_EMAIL}.

Thank you for drawing with us,
The CanvaRoom team`;
  const html = frame(
    `Premium ends on ${until}. Renew anytime; you won't lose a day.`,
    `${doodles(['⏳', '🎨', '📌'])}
<p style="margin:0 0 6px;font-size:24px;font-weight:800;letter-spacing:-0.5px">Your Premium ends on ${escapeHtml(until)}</p>
<p style="margin:0 0 18px">Hi ${escapeHtml(reminder.name)}, a small heads-up before your Premium time runs out. Thank you for spending these months drawing and teaching with us.</p>
${doodleCard(
  `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED}">Good to know</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">
<tr><td style="padding:4px 10px 4px 0;vertical-align:top">💳</td><td style="padding:4px 0">Premium doesn’t renew on its own, so <strong>nothing will be charged</strong>.</td></tr>
<tr><td style="padding:4px 10px 4px 0;vertical-align:top">➕</td><td style="padding:4px 0">Renewing adds the new time <strong>after ${escapeHtml(until)}</strong>, so you don’t lose a single day.</td></tr>
<tr><td style="padding:4px 10px 4px 0;vertical-align:top">🗂️</td><td style="padding:4px 0">Your boards stay yours either way. The free plan keeps your first board.</td></tr>
</table>`,
)}
<p style="margin:0 0 14px">Keep unlimited boards, people, exports, images and recording for 3, 6 or 12 months:</p>
${button(renew, 'Renew Premium →')}
${thoughtBlock(reminder.paidUntil)}
<p style="margin:0 0 22px">Any question? Just reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${ACCENT}">${SUPPORT_EMAIL}</a>.</p>
<p style="margin:0 0 6px">Thank you for drawing with us,<br><strong>The CanvaRoom team</strong></p>`,
  );
  return { subject, html, text };
}

/** Reminds a customer that Premium ends soon. */
export async function sendPremiumReminder(
  to: string,
  reminder: PremiumReminderMail,
) {
  const { subject, html, text } = premiumReminderEmail(reminder);
  await send(to, subject, html, text, SUPPORT_EMAIL);
}

export type CheckoutReminderMail = {
  name: string;
  checkoutUrl: string;
};

/** A gentle note for someone who started Premium checkout but hasn't paid. */
export function checkoutReminderEmail(reminder: CheckoutReminderMail) {
  const subject = '🎨 Still thinking about CanvaRoom Premium?';
  const text = `Hi ${reminder.name},

You started upgrading to CanvaRoom Premium but the payment didn't go through, so we wanted to check in. No pressure at all.

If Premium would help you keep ideas moving, you can pick up right where you left off:
${reminder.checkoutUrl}

What Premium unlocks:
${PREMIUM_PERKS.map((perk) => `- ${perk}`).join('\n')}

It's a one-time pass that never renews on its own, and your boards are safe either way.

If the payment screen got stuck, your card was declined, or something else went wrong, just reply to this email. A real person reads every message and we'll help you sort it out. If you've already paid, please ignore this note.

${thoughtText(reminder.checkoutUrl)}

The CanvaRoom team`;
  const perkIcons = ['🏫', '👀', '📤', '🖼️', '🎬'];
  const html = frame(
    'Your Premium checkout is waiting. Need a hand with the payment?',
    `${doodles(['🎨', '✏️', '💭'])}
<p style="margin:0 0 6px;font-size:24px;font-weight:800;letter-spacing:-0.5px">Still thinking about Premium?</p>
<p style="margin:0 0 18px">Hi ${escapeHtml(reminder.name)}, you started upgrading to CanvaRoom Premium but the payment didn’t go through, so we wanted to check in. No pressure at all.</p>
${doodleCard(
  `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED}">Waiting for you</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">${PREMIUM_PERKS.map(
    (perk, index) =>
      `<tr><td style="padding:4px 12px 4px 0;vertical-align:top;font-size:17px">${perkIcons[index] ?? '✅'}</td><td style="padding:4px 0">${escapeHtml(perk)}</td></tr>`,
  ).join('')}</table>`,
)}
${button(reminder.checkoutUrl, 'Pick up where you left off →')}
${doodleCard(
  `<p style="margin:0 0 4px;font-weight:800">🛟 Payment got stuck?</p>
<p style="margin:0;font-size:14px">If the payment screen froze, your card was declined, or something else went wrong, just reply to this email. A real person reads every message and we’ll help you sort it out.</p>`,
  '#eef6ff',
  '#9db6ff',
)}
<p style="margin:0 0 18px;color:${MUTED};font-size:13px">Premium is a one-time pass that never renews on its own, and your boards are safe either way. Already paid? Please ignore this note.</p>
${thoughtBlock(reminder.checkoutUrl)}
<p style="margin:0 0 6px">Happy drawing,<br><strong>The CanvaRoom team</strong></p>`,
  );
  return { subject, html, text };
}

/** Sends a single checkout recovery email, with replies routed to support. */
export async function sendCheckoutReminder(
  to: string,
  reminder: CheckoutReminderMail,
) {
  const { subject, html, text } = checkoutReminderEmail(reminder);
  await send(to, subject, html, text, SUPPORT_EMAIL);
}

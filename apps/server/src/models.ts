export type Role = 'owner' | 'editor' | 'viewer';

export type BoardObject = {
  id: string;
  kind:
    | 'path'
    | 'line'
    | 'rect'
    | 'ellipse'
    | 'diamond'
    | 'triangle'
    | 'right-triangle'
    | 'parallelogram'
    | 'trapezoid'
    | 'pentagon'
    | 'hexagon'
    | 'star'
    | 'cylinder'
    | 'bubble'
    | 'arrow'
    | 'text'
    | 'sticky'
    | 'image';
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: number[];
  text?: string;
  src?: string;
  color: string;
  strokeWidth: number;
  rotation?: number;
  fontSize?: number;
  opacity?: number;
  fillColor?: string;
  /** Mirrored left-to-right (flipX) or top-to-bottom (flipY). */
  flipX?: boolean;
  flipY?: boolean;
  /** The page this object sits on. Missing or unknown pages mean the first page. */
  page?: string;
};

export type Page = { id: string; name: string };

/** Chat messages and snapshots kept per board; older ones are dropped. */
export const MAX_MESSAGES = 500;
export const MAX_SNAPSHOTS = 50;

export const DEFAULT_PAGES: Page[] = [{ id: 'p1', name: 'Page 1' }];

/**
 * Where objects without a known page live: the board's original first page
 * while it exists, so reordering pages never moves older objects.
 */
export function homePage(pages: readonly Page[]) {
  return pages.some((page) => page.id === 'p1') ? 'p1' : pages[0]!.id;
}

/** The page an object is shown on, given the board's current pages. */
export function pageOf(object: { page?: string }, pages: readonly Page[]) {
  return object.page && pages.some((page) => page.id === object.page)
    ? object.page
    : homePage(pages);
}

export type Operation = {
  id: string;
  type: 'create' | 'update' | 'delete';
  objectId: string;
  object?: BoardObject;
  fields?: Partial<BoardObject>;
};

export type Member = { role: Role; name: string };

/** Board settings and membership. Objects, chat, and snapshots are stored separately. */
export type BoardMeta = {
  id: string;
  title: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  locked: boolean;
  inviteToken: string;
  inviteRevoked: boolean;
  members: Record<string, Member>;
  pages: Page[];
  /**
   * The owner's trial and pass, which decide what the board allows. Read
   * from the owner's account, never stored with the board.
   */
  ownerPlan?: Plan;
  /** Whether this is the owner's oldest board: the one the free plan keeps. */
  ownerFirstBoard?: boolean;
};

export type ChatMessage = {
  id: string;
  userId: string;
  name: string;
  text: string;
  createdAt: string;
};

export type Snapshot = {
  id: string;
  createdAt: string;
  title: string;
  objects: BoardObject[];
  pages?: Page[];
};

/** A signed-in person: an account holder, or a guest who joined by invite. */
export type User = {
  id: string;
  name: string;
  color: string;
  guest: boolean;
  email?: string;
  role?: 'user' | 'admin';
  /** Account holders only, and only ever sent to that person. */
  plan?: Plan;
  emailVerified?: boolean;
  /** Whether a verification code can be emailed right now. */
  verifyAvailable?: boolean;
};

/**
 * An account's free trial and paid pass. The trial is 30 minutes of active
 * use, not wall-clock time: `trialUsedSeconds` only grows while the person
 * has CanvaRoom open in a visible tab (see `accrueTrial`).
 */
export type Plan = {
  trialUsedSeconds: number;
  /** When active time was last counted; a beat after a long gap adds none. */
  trialBeatAt?: string;
  paidUntil?: string;
};

/** Minutes of active use a new account's trial includes. */
export const TRIAL_MINUTES = 30;
export const TRIAL_SECONDS = TRIAL_MINUTES * 60;
/**
 * Heartbeats arrive every 20 s or so while someone is active. A longer gap
 * means the tab was hidden, offline, or closed, and that time isn't counted.
 */
export const ACTIVE_GAP_MS = 35_000;

/**
 * Active trial time used by an account saved before it was counted: what its
 * wall-clock trial had already run through.
 */
export function legacyTrialUsed(
  account: Pick<Account, 'createdAt' | 'trialEndsAt'>,
  now = Date.now(),
) {
  const ends = account.trialEndsAt
    ? Date.parse(account.trialEndsAt)
    : Date.parse(account.createdAt) + TRIAL_SECONDS * 1000;
  return Math.min(
    TRIAL_SECONDS,
    Math.max(0, TRIAL_SECONDS - (ends - now) / 1000),
  );
}

/**
 * Premium while a paid month runs, then the trial while it lasts, then free.
 * The board owner's tier decides what a board allows.
 */
export type Tier = 'premium' | 'trial' | 'free';

/** Boards an account may own on the trial, and on the free plan after it. */
export const TRIAL_BOARDS = 2;
export const FREE_BOARDS = 1;
/** People besides the owner who may join a trial board. */
export const TRIAL_GUESTS = 2;

export function tierOf(plan: Plan | undefined, now = Date.now()): Tier {
  if (!plan) return 'free';
  if (plan.paidUntil && Date.parse(plan.paidUntil) > now) return 'premium';
  if (plan.trialUsedSeconds < TRIAL_SECONDS) return 'trial';
  return 'free';
}

/**
 * When a paid month runs out; undefined otherwise. The trial has no end time,
 * since it only counts down while the person is active.
 */
export function tierEndsAt(plan: Plan | undefined, now = Date.now()) {
  return tierOf(plan, now) === 'premium' ? plan!.paidUntil : undefined;
}

/**
 * Counts active trial time for a heartbeat at `now`: the time since the last
 * beat, unless that gap shows the person wasn't active. Returns the account's
 * new trial fields, or undefined when nothing changes (Premium, or used up).
 */
export function accruedTrial(
  account: Pick<
    Account,
    | 'createdAt'
    | 'trialEndsAt'
    | 'trialUsedSeconds'
    | 'trialBeatAt'
    | 'paidUntil'
  >,
  now = Date.now(),
): Pick<Account, 'trialUsedSeconds' | 'trialBeatAt'> | undefined {
  if (account.paidUntil && Date.parse(account.paidUntil) > now) return;
  const used = account.trialUsedSeconds ?? legacyTrialUsed(account, now);
  if (used >= TRIAL_SECONDS) return;
  const gap = account.trialBeatAt
    ? now - Date.parse(account.trialBeatAt)
    : Infinity;
  const counted = gap >= 0 && gap <= ACTIVE_GAP_MS ? gap / 1000 : 0;
  return {
    trialUsedSeconds: Math.min(TRIAL_SECONDS, used + counted),
    trialBeatAt: new Date(now).toISOString(),
  };
}

/** An account's trial and pass. */
export const planOf = (account: Account): Plan => ({
  trialUsedSeconds: account.trialUsedSeconds ?? legacyTrialUsed(account),
  ...(account.trialBeatAt ? { trialBeatAt: account.trialBeatAt } : {}),
  ...(account.paidUntil ? { paidUntil: account.paidUntil } : {}),
});

/** A note sent through the site's feedback form. */
export type Feedback = {
  id: string;
  userId?: string;
  email: string;
  name?: string;
  category: string;
  rating?: number;
  message: string;
  page?: string;
  createdAt: string;
};

/** An order this server created with Razorpay or PayPal, and whether it has been paid. */
export type Payment = {
  orderId: string;
  /** Who took the payment. Missing on orders from before PayPal, and before
   * the database stores it: those are Razorpay's (IDs start `order_`). */
  provider?: PaymentProvider;
  userId: string;
  amount: number;
  currency: string;
  /** `expired`: nobody paid within EXPIRE_AFTER_HOURS. A payment that
   * still arrives later is applied all the same. */
  status: 'created' | 'paid' | 'expired';
  /** The plan bought, and the months and extra days it adds. Missing on
   * one-month orders from before the plans. */
  plan?: string;
  months?: number;
  days?: number;
  paymentId?: string;
  createdAt: string;
  paidAt?: string;
  /** When a full refund took the order's Premium time back. */
  refundedAt?: string;
  /** The latest checkout step for this order, like `client.dismissed`. */
  lastEvent?: string;
  lastEventAt?: string;
  /** Why it failed or expired, in words, when it did. */
  failureReason?: string;
  expiredAt?: string;
};

export type PaymentProvider = 'razorpay' | 'paypal';

export type BankTransferRequest = {
  id: string;
  userId: string;
  plan: string;
  amount: number;
  currency: 'USD';
  months: number;
  days: number;
  reference: string;
  status: 'instructions' | 'pending' | 'confirmed' | 'rejected';
  senderReference?: string;
  createdAt: string;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  paidUntil?: string;
};

export type AdminBankTransferRequest = BankTransferRequest & {
  email: string;
  name: string;
};

export type BankTransferReviewResult =
  | { outcome: 'confirmed'; userId: string; paidUntil: string }
  | { outcome: 'repeat'; userId: string; paidUntil?: string }
  | { outcome: 'rejected'; userId: string }
  | { outcome: 'not_pending'; userId: string }
  | { outcome: 'unknown' };

/** An old unpaid checkout with the address to reach its account. */
export type CheckoutReminder = {
  orderId: string;
  userId: string;
  email: string;
  name: string;
  plan?: string;
  createdAt: string;
};

/** Who took an order: as stored, or else from the shape of its ID. */
export const providerOf = (payment: Pick<Payment, 'orderId' | 'provider'>) =>
  payment.provider ??
  (payment.orderId.startsWith('order_') ? 'razorpay' : 'paypal');

/** An account whose Premium ends soon, to remind once per end date. */
export type PremiumReminder = {
  userId: string;
  email: string;
  name: string;
  paidUntil: string;
};

/**
 * A captured payment (Razorpay or PayPal) for one of our orders. The same
 * payment can be reported by the browser after checkout, by the provider's
 * webhook, and by reconciling an order, in any order and more than once.
 */
export type Capture = {
  orderId: string;
  paymentId: string;
  source: 'checkout' | 'webhook' | 'reconcile';
  /** What Razorpay says was paid; checked against the order when given. */
  amount?: number;
  currency?: string;
};

export type CaptureResult =
  /** This payment extended the pass. */
  | { outcome: 'applied'; userId: string; paidUntil: string }
  /** This payment was applied before; nothing changed. */
  | { outcome: 'repeat'; userId: string }
  /** The order was already paid by another payment; this one needs a refund. */
  | { outcome: 'extra'; userId: string }
  /** The amount or currency differs from the order; nothing changed. */
  | { outcome: 'mismatch'; userId: string }
  /** Not one of our orders. */
  | { outcome: 'unknown' };

export type RefundResult =
  /** A full refund: the order's Premium time was taken back. */
  | { outcome: 'refunded'; userId: string; paidUntil?: string }
  /** This refund was handled before. */
  | { outcome: 'repeat'; userId: string }
  /** Less than the whole order was refunded; Premium is left alone. */
  | { outcome: 'partial'; userId: string }
  /** No paid order of ours has this payment. */
  | { outcome: 'unknown' }
  /** The database can't record refunds until it is migrated. */
  | { outcome: 'unmigrated' };

export type AccountRole = 'user' | 'admin';

export type Account = {
  id: string;
  email: string;
  role?: AccountRole;
  /** Existing accounts are migrated as verified; newly registered accounts must verify first. */
  emailVerified?: boolean;
  name: string;
  color: string;
  createdAt: string;
  /** `scrypt$N$r$p$salt$hash`, never sent to clients. */
  passwordHash: string;
  /**
   * The wall-clock trial end used before trials counted active time. Only
   * read for accounts saved before then; see `legacyTrialUsed`.
   */
  trialEndsAt?: string;
  /** Active trial time used, in seconds. */
  trialUsedSeconds?: number;
  trialBeatAt?: string;
  paidUntil?: string;
  /** The Premium end date the renewal reminder was sent for. */
  premiumRemindedFor?: string;
};

/** Server-side session, stored under a hash of the cookie token. */
export type SessionRecord = {
  userId: string;
  /** Present for guests, who have no account record. */
  guest?: { name: string; color: string };
};

/** One connected tab. `peerId` is stable across reconnects so audio peers survive them. */
/** A microphone track published to Cloudflare Realtime. */
export type AudioTrack = { session: string; track: string };

export type Presence = {
  peerId: string;
  userId: string;
  name: string;
  color: string;
  inCall: boolean;
  muted: boolean;
  /** The tab has been hidden for a while. */
  away?: boolean;
  /** Their microphone on the SFU, for others in the call to pull. */
  audio?: AudioTrack;
  updatedAt: number;
  /** The server instance holding this tab's socket. */
  instance?: string;
};

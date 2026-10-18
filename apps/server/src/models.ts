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
  /** Account holders only, and only ever sent to that person. */
  plan?: Plan;
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

/** A Razorpay order this server created, and whether it has been paid. */
export type Payment = {
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  status: 'created' | 'paid';
  paymentId?: string;
  createdAt: string;
  paidAt?: string;
};

export type Account = {
  id: string;
  email: string;
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

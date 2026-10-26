'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, send } from '../lib/api';
import './admin.css';

type AdminPayment = {
  provider: string;
  status: string;
  plan: string | null;
  months: number | null;
  days: number | null;
  amount: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
};
type AdminGrant = {
  id: string;
  adminUsername: string;
  months: number;
  days: number;
  method: string;
  reference: string | null;
  note: string | null;
  paidUntil: string;
  createdAt: string;
};
type AdminUser = {
  id: string;
  email: string;
  role: 'user' | 'admin';
  emailVerified: boolean;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  online: boolean;
  boardCount: number;
  trialUsedSeconds: number;
  paidUntil: string | null;
  paymentCount: number;
  payments: AdminPayment[];
  grants: AdminGrant[];
};
type UserPage = { total: number; users: AdminUser[] };
type AdminBankTransfer = {
  id: string;
  userId: string;
  name: string;
  email: string;
  plan: string;
  amount: number;
  currency: string;
  months: number;
  days: number;
  reference: string;
  status: string;
  senderReference?: string;
  submittedAt?: string;
};
type AdminAction = {
  id: string;
  adminUsername: string;
  action: string;
  userId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
};
type Revenue = {
  currency: string;
  total: number;
  month: number;
  last30: number;
  today: number;
  orders: number;
  refunded: number;
};
type Overview = {
  accounts: {
    total: number;
    verified: number;
    premium: number;
    online: number;
    activeDay: number;
    newWeek: number;
    admins: number;
  };
  revenue: Revenue[];
  daily: { day: string; currency: string; amount: number }[];
  plans: { plan: string; count: number }[];
  activity: AdminAction[];
  onlineSeconds: number;
};
type Currency = 'USD' | 'INR';
type PriceSet = [number, number, number];
type PricePlan = {
  id: string;
  amount: number;
  compareAt: number;
  savePercent: number;
  months: number;
  bonusMonths: number;
  bonusDays: number;
  perMonth: number;
};
type Prices = {
  current: Record<Currency, PriceSet>;
  defaults: Record<Currency, PriceSet>;
  plans: Record<Currency, PricePlan[]>;
};
type AdminMe = {
  authenticated: boolean;
  configured: boolean;
  username?: string;
};
type GrantMethod = 'cash' | 'bank_transfer' | 'complimentary' | 'other';
type Section = 'overview' | 'users' | 'pricing' | 'transfers';
type Filter = 'all' | 'online' | 'premium' | 'unverified' | 'admins';

const PAGE_SIZE = 50;
const TRIAL_SECONDS = 30 * 60;
const CURRENCIES: Currency[] = ['USD', 'INR'];
const PLAN_NAMES = ['3 months', '6 months', '12 months'];
const PLAN_TERMS = [
  { months: 3, bonus: 0 },
  { months: 6, bonus: 0.5 },
  { months: 12, bonus: 1 },
];

const dateTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : '—';
const shortDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(
    new Date(`${value}T00:00:00Z`),
  );
function ago(value: string | null, now: number) {
  if (!value) return 'Never';
  const seconds = Math.max(0, (now - Date.parse(value)) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 86_400 * 30) return `${Math.floor(seconds / 86_400)} d ago`;
  return dateTime(value);
}
const statusFor = (user: AdminUser, now = Date.now()) => {
  if (user.paidUntil && Date.parse(user.paidUntil) > now) return 'Premium';
  return user.trialUsedSeconds < TRIAL_SECONDS ? 'Trial' : 'Free';
};
const methodLabel = (value: string) =>
  (
    ({
      cash: 'Cash',
      bank_transfer: 'Bank transfer',
      complimentary: 'Complimentary',
      other: 'Other',
      razorpay: 'Razorpay',
      paypal: 'PayPal',
    }) as Record<string, string>
  )[value] ?? value;
const money = (amount: number, currency: string, compact = false) => {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      ...(compact
        ? { notation: 'compact', maximumFractionDigits: 1 }
        : { maximumFractionDigits: amount % 100 ? 2 : 0 }),
    }).format(amount / 100);
  } catch {
    return `${currency} ${(amount / 100).toFixed(2)}`;
  }
};
const shortTerm = (months: number | null, days: number | null) => {
  const parts = [months ? `${months} mo` : '', days ? `${days} d` : ''].filter(
    Boolean,
  );
  return parts.join(' + ') || '—';
};
const paymentTerm = (
  payment: Pick<AdminPayment, 'plan' | 'months' | 'days'>,
) => {
  const term = shortTerm(payment.months, payment.days);
  if (term !== '—') return term;
  return (
    (
      {
        quarterly: '3 months',
        'half-year': '6 months + 15 days',
        yearly: '13 months',
      } as Record<string, string>
    )[payment.plan ?? ''] ?? 'Legacy term'
  );
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '?';
const ACTION_LABELS: Record<string, string> = {
  create_user: 'added an account',
  delete_user: 'removed an account',
  verify_email: 'verified an email',
  unverify_email: 'marked an email unverified',
  revoke_premium: 'revoked Premium',
  set_prices: 'changed prices',
  reset_prices: 'reset prices to default',
};
function actionSummary(action: AdminAction) {
  const detail = action.detail;
  const label = ACTION_LABELS[action.action] ?? action.action;
  if (action.action === 'set_prices' || action.action === 'reset_prices')
    return `${label} (${String(detail.currency ?? '')})`;
  const who = (detail.email as string) ?? action.userId ?? '';
  return who ? `${label}: ${who}` : label;
}

/** Savings shown for a set of whole-unit prices, the way the server works them out. */
function previewPlans(prices: PriceSet) {
  const base = prices[0] / 3;
  return prices.map((amount, index) => {
    const term = PLAN_TERMS[index]!;
    const compareAt = Math.round(base * term.months);
    const savePercent = Math.max(
      0,
      Math.ceil(((compareAt - amount) / compareAt) * 100 - 0.5),
    );
    return {
      savePercent,
      perMonth: amount / (term.months + term.bonus),
    };
  });
}

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '◎' },
  { id: 'users', label: 'Users', icon: '◍' },
  { id: 'pricing', label: 'Pricing', icon: '◈' },
  { id: 'transfers', label: 'Bank transfers', icon: '⇄' },
];
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'premium', label: 'Premium' },
  { id: 'unverified', label: 'Unverified' },
  { id: 'admins', label: 'Admins' },
];

export default function AdminClient() {
  const [checked, setChecked] = useState(false);
  const [now, setNow] = useState(0);
  const [authenticated, setAuthenticated] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<Section>('overview');
  const [toast, setToast] = useState<{ text: string; tone?: 'error' } | null>(
    null,
  );

  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<AdminUser[]>([]);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [adding, setAdding] = useState(false);

  const [bankTransfers, setBankTransfers] = useState<AdminBankTransfer[]>([]);
  const [transferError, setTransferError] = useState('');
  const [reviewingTransfer, setReviewingTransfer] = useState('');

  const [prices, setPrices] = useState<Prices | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    api<AdminMe>('/admin/me')
      .then((result) => {
        setAuthenticated(result.authenticated);
        setConfigured(result.configured);
        if (result.username) setUsername(result.username);
      })
      .catch(() => setConfigured(false))
      .finally(() => setChecked(true));
  }, []);

  const handleError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof ApiError && error.status === 401)
      setAuthenticated(false);
    return error instanceof Error ? error.message : fallback;
  }, []);

  const loadOverview = useCallback(async () => {
    if (!authenticated) return;
    try {
      const [result, online] = await Promise.all([
        api<Overview>('/admin/overview'),
        api<UserPage>('/admin/users?filter=online&limit=12'),
      ]);
      setOverview(result);
      setOnlineUsers(online.users);
      setOverviewError('');
    } catch (error) {
      setOverviewError(handleError(error, 'Could not load the overview.'));
    }
  }, [authenticated, handleError]);

  const loadUsers = useCallback(async () => {
    if (!authenticated) return;
    setListError('');
    try {
      const params = new URLSearchParams({
        q: query,
        page: String(page),
        limit: String(PAGE_SIZE),
        filter,
      });
      const result = await api<UserPage>(`/admin/users?${params}`);
      setUsers(result.users);
      setTotal(result.total);
      setSelected((current) =>
        current
          ? (result.users.find((user) => user.id === current.id) ?? current)
          : null,
      );
    } catch (error) {
      setListError(handleError(error, 'Could not load accounts.'));
    }
  }, [authenticated, page, query, filter, handleError]);

  const loadBankTransfers = useCallback(async () => {
    if (!authenticated) return;
    setTransferError('');
    try {
      const result = await api<{ transfers: AdminBankTransfer[] }>(
        '/admin/bank-transfers',
      );
      setBankTransfers(result.transfers);
    } catch (error) {
      setTransferError(handleError(error, 'Could not load bank transfers.'));
    }
  }, [authenticated, handleError]);

  const loadPrices = useCallback(async () => {
    if (!authenticated) return;
    try {
      setPrices(await api<Prices>('/admin/prices'));
    } catch (error) {
      setToast({
        text: handleError(error, 'Could not load prices.'),
        tone: 'error',
      });
    }
  }, [authenticated, handleError]);

  // The overview and online list refresh every 30 seconds while open.
  useEffect(() => {
    if (!authenticated) return;
    void loadOverview();
    void loadBankTransfers();
    const timer = window.setInterval(() => void loadOverview(), 30_000);
    return () => window.clearInterval(timer);
  }, [authenticated, loadOverview, loadBankTransfers]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 180);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  useEffect(() => {
    if (section === 'pricing' && !prices) void loadPrices();
  }, [section, prices, loadPrices]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setLoginError('');
    try {
      await send('/admin/login', 'POST', {
        username: username.trim().toLowerCase(),
        password,
      });
      setAuthenticated(true);
      setPassword('');
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : 'Could not sign in.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await send('/admin/logout', 'POST').catch(() => undefined);
    setAuthenticated(false);
    setSelected(null);
  }

  /** Refreshes everything a change to one account can touch. */
  const afterUserChange = useCallback(async () => {
    await Promise.all([loadUsers(), loadOverview()]);
  }, [loadUsers, loadOverview]);

  async function reviewBankTransfer(
    transfer: AdminBankTransfer,
    action: 'confirm' | 'reject',
  ) {
    setReviewingTransfer(transfer.id);
    setTransferError('');
    try {
      await send(
        `/admin/bank-transfers/${encodeURIComponent(transfer.id)}/${action}`,
        'POST',
      );
      setBankTransfers((current) =>
        current.filter((item) => item.id !== transfer.id),
      );
      setToast({
        text:
          action === 'confirm'
            ? `Premium granted to ${transfer.name}.`
            : 'Transfer rejected.',
      });
      if (action === 'confirm') void afterUserChange();
    } catch (error) {
      setTransferError(handleError(error, 'Could not review transfer.'));
      void loadBankTransfers();
    } finally {
      setReviewingTransfer('');
    }
  }

  function openUsers(nextFilter: Filter) {
    setFilter(nextFilter);
    setPage(1);
    setSection('users');
  }

  if (!checked)
    return <main className="admin-loading">Opening admin console…</main>;

  if (!authenticated)
    return (
      <main className="admin-login-page">
        <div className="admin-login-card">
          <a className="admin-brand" href="/" aria-label="CanvaRoom home">
            <span className="admin-brand-mark">C</span> CanvaRoom
          </a>
          <span className="kicker">Private workspace</span>
          <h1>Admin sign in</h1>
          <p>
            Sign in with the email and password of an account with the Admin
            role.
          </p>
          {!configured && (
            <div className="admin-alert">
              Admin sign-in requires the Postgres database.
            </div>
          )}
          <form onSubmit={login} className="admin-login-form">
            <label>
              Admin email
              <input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {loginError && (
              <div className="admin-alert" role="alert">
                {loginError}
              </div>
            )}
            <button
              className="button primary wide"
              disabled={busy || !configured}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <a className="admin-back-link" href="/">
            ← Back to CanvaRoom
          </a>
        </div>
      </main>
    );

  return (
    <main className="admin-page admin-shell">
      <aside className="admin-side">
        <a className="admin-brand" href="/" aria-label="CanvaRoom home">
          <span className="admin-brand-mark">C</span> CanvaRoom
        </a>
        <span className="admin-side-label">Admin console</span>
        <nav className="admin-nav" aria-label="Admin sections">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={section === item.id ? 'is-active' : ''}
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setSection(item.id)}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.id === 'transfers' && bankTransfers.length > 0 && (
                <em>{bankTransfers.length}</em>
              )}
              {item.id === 'users' && overview && (
                <small className="admin-nav-live">
                  <i /> {overview.accounts.online}
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="admin-side-foot">
          <span title={username}>{username || 'Administrator'}</span>
          <button className="button ghost small" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="admin-content">
        {section === 'overview' && (
          <OverviewSection
            overview={overview}
            error={overviewError}
            online={onlineUsers}
            now={now}
            pendingTransfers={bankTransfers.length}
            onOpenUsers={openUsers}
            onOpenUser={(user) => setSelected(user)}
            onOpenTransfers={() => setSection('transfers')}
          />
        )}

        {section === 'users' && (
          <section className="admin-directory">
            <div className="admin-directory-head">
              <div>
                <span className="kicker">Accounts</span>
                <h1 className="admin-title">Users</h1>
                <p>Verify, grant or revoke Premium, add and remove accounts.</p>
              </div>
              <button
                className="button primary"
                onClick={() => setAdding(true)}
              >
                + Add user
              </button>
            </div>
            <div className="admin-toolbar">
              <div className="admin-chips" role="tablist">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    role="tab"
                    aria-selected={filter === item.id}
                    className={`admin-chip ${filter === item.id ? 'is-active' : ''}`}
                    onClick={() => {
                      setFilter(item.id);
                      setPage(1);
                    }}
                  >
                    {item.id === 'online' && <i className="admin-dot" />}
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="admin-search">
                <span aria-hidden="true">⌕</span>
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search name, email or ID"
                  aria-label="Search accounts"
                />
              </label>
            </div>
            {listError && (
              <div className="admin-alert" role="alert">
                {listError}
              </div>
            )}
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Status</th>
                    <th>Access</th>
                    <th>Last seen</th>
                    <th>Payments</th>
                    <th>
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const entitlement = statusFor(user, now);
                    const recent = user.payments[0];
                    return (
                      <tr key={user.id}>
                        <td>
                          <div className="admin-user-cell">
                            <Avatar user={user} />
                            <div>
                              <strong>
                                {user.name}
                                {user.role === 'admin' && (
                                  <span className="admin-pill is-admin">
                                    Admin
                                  </span>
                                )}
                              </strong>
                              <span className="admin-secondary">
                                {user.email}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`admin-pill ${user.emailVerified ? 'is-good' : 'is-waiting'}`}
                          >
                            {user.emailVerified ? 'Verified' : 'Unverified'}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`admin-pill ${entitlement === 'Premium' ? 'is-premium' : ''}`}
                          >
                            {entitlement}
                          </span>
                          <span className="admin-secondary">
                            {entitlement === 'Premium'
                              ? `Until ${dateTime(user.paidUntil)}`
                              : `${user.boardCount} board${user.boardCount === 1 ? '' : 's'}`}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`admin-presence ${user.online ? 'is-online' : ''}`}
                          >
                            <i />
                            {user.online
                              ? 'Online now'
                              : ago(user.lastSeenAt, now)}
                          </span>
                        </td>
                        <td>
                          {recent ? (
                            <>
                              <strong>
                                {money(recent.amount, recent.currency)}
                              </strong>
                              <span className="admin-secondary">
                                {methodLabel(recent.provider)} ·{' '}
                                {recent.refundedAt
                                  ? 'Refunded'
                                  : recent.status === 'paid'
                                    ? 'Paid'
                                    : 'Unpaid'}
                              </span>
                            </>
                          ) : user.grants[0] ? (
                            <>
                              <strong>Manual</strong>
                              <span className="admin-secondary">
                                {methodLabel(user.grants[0].method)}
                              </span>
                            </>
                          ) : (
                            <span className="admin-secondary">None</span>
                          )}
                        </td>
                        <td className="admin-row-actions">
                          <button
                            className="button ghost small"
                            onClick={() => setSelected(user)}
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!users.length && !listError && (
                <div className="admin-empty">
                  {query || filter !== 'all'
                    ? 'No accounts match.'
                    : 'No registered accounts yet.'}
                </div>
              )}
            </div>
            <div className="admin-pagination">
              <span>
                {total
                  ? `${((page - 1) * PAGE_SIZE + 1).toLocaleString()}–${Math.min(page * PAGE_SIZE, total).toLocaleString()} of ${total.toLocaleString()}`
                  : '0 accounts'}
              </span>
              <div>
                <button
                  className="button ghost small"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
                </span>
                <button
                  className="button ghost small"
                  disabled={page >= Math.ceil(total / PAGE_SIZE)}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        )}

        {section === 'pricing' && (
          <PricingSection
            prices={prices}
            onSaved={(next, text) => {
              setPrices(next);
              setToast({ text });
              void loadOverview();
            }}
            onError={(text) => setToast({ text, tone: 'error' })}
          />
        )}

        {section === 'transfers' && (
          <section className="admin-directory">
            <div className="admin-directory-head">
              <div>
                <span className="kicker">Payments</span>
                <h1 className="admin-title">USD bank transfers</h1>
                <p>
                  Confirm only after matching the payment in the USD balance.
                  Confirming grants the listed Premium term.
                </p>
              </div>
              <span className="admin-pill is-waiting">
                {bankTransfers.length} awaiting review
              </span>
            </div>
            {transferError && (
              <div className="admin-alert" role="alert">
                {transferError}
              </div>
            )}
            {bankTransfers.length ? (
              <ul className="admin-transfer-list">
                {bankTransfers.map((transfer) => (
                  <li key={transfer.id} className="admin-transfer-card">
                    <div className="admin-transfer-info">
                      <strong>{transfer.name}</strong>
                      <span>{transfer.email}</span>
                      <span>
                        {paymentTerm(transfer)} ·{' '}
                        {money(transfer.amount, transfer.currency)}
                      </span>
                      <span>
                        App reference: <code>{transfer.reference}</code>
                      </span>
                      {transfer.senderReference && (
                        <span>
                          Sender reference:{' '}
                          <code>{transfer.senderReference}</code>
                        </span>
                      )}
                      <span>Submitted {dateTime(transfer.submittedAt)}</span>
                    </div>
                    <div className="admin-transfer-actions">
                      <button
                        className="button primary small"
                        disabled={reviewingTransfer === transfer.id}
                        onClick={() =>
                          void reviewBankTransfer(transfer, 'confirm')
                        }
                      >
                        {reviewingTransfer === transfer.id
                          ? 'Reviewing…'
                          : 'Confirm & grant'}
                      </button>
                      <button
                        className="button ghost small"
                        disabled={reviewingTransfer === transfer.id}
                        onClick={() =>
                          void reviewBankTransfer(transfer, 'reject')
                        }
                      >
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="admin-empty">
                Nothing to review. New transfers appear here once a customer
                reports sending one.
              </div>
            )}
          </section>
        )}
      </div>

      {selected && (
        <UserDrawer
          key={selected.id}
          user={selected}
          me={username}
          now={now}
          onClose={() => setSelected(null)}
          onChanged={async (text) => {
            setToast({ text });
            await afterUserChange();
          }}
          onDeleted={async (text) => {
            setSelected(null);
            setToast({ text });
            await afterUserChange();
          }}
        />
      )}

      {adding && (
        <AddUserDialog
          onClose={() => setAdding(false)}
          onCreated={async (text) => {
            setAdding(false);
            setToast({ text });
            await afterUserChange();
          }}
        />
      )}

      {toast && (
        <div
          className={`admin-toast ${toast.tone === 'error' ? 'is-error' : ''}`}
          role="status"
        >
          {toast.text}
        </div>
      )}
    </main>
  );
}

function Avatar({ user }: { user: AdminUser }) {
  return (
    <span className="admin-avatar" aria-hidden="true">
      {initials(user.name)}
      {user.online && <i />}
    </span>
  );
}

function OverviewSection({
  overview,
  error,
  online,
  now,
  pendingTransfers,
  onOpenUsers,
  onOpenUser,
  onOpenTransfers,
}: {
  overview: Overview | null;
  error: string;
  online: AdminUser[];
  now: number;
  pendingTransfers: number;
  onOpenUsers: (filter: Filter) => void;
  onOpenUser: (user: AdminUser) => void;
  onOpenTransfers: () => void;
}) {
  const currencies = useMemo(() => {
    const seen = overview?.revenue.map((row) => row.currency as Currency) ?? [];
    return seen.length ? seen : CURRENCIES;
  }, [overview]);
  const [currency, setCurrency] = useState<Currency>('INR');
  const shown = currencies.includes(currency) ? currency : currencies[0]!;
  const revenue = overview?.revenue.find((row) => row.currency === shown);
  const accounts = overview?.accounts;

  return (
    <>
      <section className="admin-heading">
        <div>
          <span className="kicker">Today at a glance</span>
          <h1 className="admin-title">Overview</h1>
          <p>Revenue, people online, and what changed recently.</p>
        </div>
        <div className="admin-segment" role="tablist" aria-label="Currency">
          {currencies.map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={item === shown}
              className={item === shown ? 'is-active' : ''}
              onClick={() => setCurrency(item)}
            >
              {item === 'INR' ? '₹ INR' : '$ USD'}
            </button>
          ))}
        </div>
      </section>
      {error && (
        <div className="admin-alert" role="alert">
          {error}
        </div>
      )}
      {pendingTransfers > 0 && (
        <button className="admin-banner" onClick={onOpenTransfers}>
          <strong>
            {pendingTransfers} bank transfer
            {pendingTransfers === 1 ? '' : 's'} waiting for review
          </strong>
          <span>Review now →</span>
        </button>
      )}

      <section className="admin-kpis" aria-label="Revenue">
        <div className="admin-kpi is-hero">
          <span>Revenue this month</span>
          <strong>{money(revenue?.month ?? 0, shown)}</strong>
          <small>
            {money(revenue?.today ?? 0, shown)} today ·{' '}
            {money(revenue?.last30 ?? 0, shown)} in 30 days
          </small>
        </div>
        <div className="admin-kpi">
          <span>All-time revenue</span>
          <strong>{money(revenue?.total ?? 0, shown)}</strong>
          <small>
            {revenue?.orders ?? 0} paid order
            {revenue?.orders === 1 ? '' : 's'}
            {revenue?.refunded ? ` · ${revenue.refunded} refunded` : ''}
          </small>
        </div>
        <button className="admin-kpi" onClick={() => onOpenUsers('online')}>
          <span>
            <i className="admin-dot" /> Online now
          </span>
          <strong>{accounts?.online ?? '—'}</strong>
          <small>{accounts?.activeDay ?? 0} active in the last 24 h</small>
        </button>
        <button className="admin-kpi" onClick={() => onOpenUsers('premium')}>
          <span>Premium accounts</span>
          <strong>{accounts?.premium ?? '—'}</strong>
          <small>
            {accounts && accounts.total
              ? `${Math.round((accounts.premium / accounts.total) * 100)}% of all accounts`
              : 'No accounts yet'}
          </small>
        </button>
        <button className="admin-kpi" onClick={() => onOpenUsers('all')}>
          <span>Registered users</span>
          <strong>{accounts?.total.toLocaleString() ?? '—'}</strong>
          <small>+{accounts?.newWeek ?? 0} this week</small>
        </button>
        <button className="admin-kpi" onClick={() => onOpenUsers('unverified')}>
          <span>Unverified emails</span>
          <strong>{accounts ? accounts.total - accounts.verified : '—'}</strong>
          <small>Verify them from Users</small>
        </button>
      </section>

      <div className="admin-grid">
        <section className="admin-card admin-chart-card">
          <div className="admin-card-head">
            <h2>Daily revenue, last 30 days</h2>
            <span className="admin-secondary">{shown}</span>
          </div>
          <RevenueChart
            daily={(overview?.daily ?? []).filter(
              (row) => row.currency === shown,
            )}
            currency={shown}
            now={now}
          />
        </section>

        <section className="admin-card">
          <div className="admin-card-head">
            <h2>
              <i className="admin-dot" /> Online now
            </h2>
            <button
              className="admin-link"
              onClick={() => onOpenUsers('online')}
            >
              See all
            </button>
          </div>
          {online.length ? (
            <ul className="admin-people">
              {online.map((user) => (
                <li key={user.id}>
                  <button onClick={() => onOpenUser(user)}>
                    <Avatar user={user} />
                    <span>
                      <strong>{user.name}</strong>
                      <small>{user.email}</small>
                    </span>
                    <em
                      className={`admin-pill ${statusFor(user, now) === 'Premium' ? 'is-premium' : ''}`}
                    >
                      {statusFor(user, now)}
                    </em>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-muted">
              Nobody is online right now. People show here while they have
              CanvaRoom open.
            </p>
          )}
        </section>

        <section className="admin-card">
          <div className="admin-card-head">
            <h2>Plans sold</h2>
          </div>
          <PlanMix plans={overview?.plans ?? []} />
        </section>

        <section className="admin-card">
          <div className="admin-card-head">
            <h2>Recent admin activity</h2>
          </div>
          {overview?.activity.length ? (
            <ol className="admin-activity">
              {overview.activity.map((action) => (
                <li key={action.id}>
                  <span>{actionSummary(action)}</span>
                  <small>
                    {action.adminUsername} · {ago(action.createdAt, now)}
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            <p className="admin-muted">
              Changes you make here are recorded and listed in this card.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

/** Thirty daily bars of one currency, with a tooltip per bar. */
function RevenueChart({
  daily,
  currency,
  now,
}: {
  daily: { day: string; amount: number }[];
  currency: Currency;
  now: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const days = useMemo(() => {
    const byDay = new Map(daily.map((row) => [row.day, row.amount]));
    const today = new Date(now);
    return Array.from({ length: 30 }, (_, index) => {
      const date = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() - (29 - index),
        ),
      );
      const key = date.toISOString().slice(0, 10);
      return { day: key, amount: byDay.get(key) ?? 0 };
    });
  }, [daily, now]);
  const max = Math.max(...days.map((day) => day.amount), 1);
  const total = days.reduce((sum, day) => sum + day.amount, 0);
  const width = 600;
  const height = 180;
  const gap = 4;
  const barWidth = width / days.length - gap;
  const best = days.reduce((top, day) => (day.amount > top.amount ? day : top));
  return (
    <div className="admin-chart">
      <svg
        viewBox={`0 0 ${width} ${height + 22}`}
        role="img"
        aria-label={`Daily revenue in ${currency} for the last 30 days: ${money(total, currency)} in total${best.amount ? `, highest on ${shortDate(best.day)} with ${money(best.amount, currency)}` : ''}.`}
        onMouseLeave={() => setHover(null)}
      >
        {[0.5, 1].map((line) => (
          <line
            key={line}
            x1="0"
            x2={width}
            y1={height - height * line}
            y2={height - height * line}
            className="admin-chart-grid"
          />
        ))}
        <line
          x1="0"
          x2={width}
          y1={height}
          y2={height}
          className="admin-chart-axis"
        />
        {days.map((day, index) => {
          const barHeight = day.amount
            ? Math.max(4, (day.amount / max) * (height - 8))
            : 0;
          const x = index * (barWidth + gap) + gap / 2;
          return (
            <g key={day.day}>
              <rect
                x={x - gap / 2}
                y="0"
                width={barWidth + gap}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
                onFocus={() => setHover(index)}
                tabIndex={-1}
              />
              {barHeight > 0 && (
                <path
                  className={`admin-chart-bar ${hover === index ? 'is-hover' : ''}`}
                  d={`M${x} ${height}V${height - barHeight + 4}q0 -4 4 -4h${barWidth - 8}q4 0 4 4V${height}Z`}
                  pointerEvents="none"
                />
              )}
              {index % 7 === 0 && (
                <text
                  x={x + barWidth / 2}
                  y={height + 16}
                  className="admin-chart-label"
                >
                  {shortDate(day.day)}
                </text>
              )}
            </g>
          );
        })}
        <text x={width} y="12" textAnchor="end" className="admin-chart-label">
          {money(max === 1 ? 0 : max, currency, true)}
        </text>
      </svg>
      {hover !== null && (
        <div
          className="admin-chart-tip"
          style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}
        >
          <strong>{money(days[hover]!.amount, currency)}</strong>
          <span>{shortDate(days[hover]!.day)}</span>
        </div>
      )}
      {!total && (
        <p className="admin-chart-empty">
          No {currency} payments in the last 30 days.
        </p>
      )}
    </div>
  );
}

function PlanMix({ plans }: { plans: { plan: string; count: number }[] }) {
  const labels: Record<string, string> = {
    quarterly: '3 months',
    'half-year': '6 months',
    yearly: '12 months',
    legacy: 'Older monthly',
  };
  const total = plans.reduce((sum, item) => sum + item.count, 0);
  if (!total) return <p className="admin-muted">No Premium plans sold yet.</p>;
  return (
    <ul className="admin-mix">
      {['quarterly', 'half-year', 'yearly', 'legacy'].map((id) => {
        const count = plans.find((item) => item.plan === id)?.count ?? 0;
        if (!count && id === 'legacy') return null;
        const share = count / total;
        return (
          <li key={id}>
            <span>{labels[id]}</span>
            <span className="admin-mix-bar">
              <i
                style={{ width: `${Math.max(share * 100, count ? 3 : 0)}%` }}
              />
            </span>
            <strong>
              {count} <small>({Math.round(share * 100)}%)</small>
            </strong>
          </li>
        );
      })}
    </ul>
  );
}

function PricingSection({
  prices,
  onSaved,
  onError,
}: {
  prices: Prices | null;
  onSaved: (prices: Prices, text: string) => void;
  onError: (text: string) => void;
}) {
  if (!prices)
    return (
      <section className="admin-heading">
        <div>
          <span className="kicker">Plans</span>
          <h1 className="admin-title">Pricing</h1>
          <p>Loading prices…</p>
        </div>
      </section>
    );
  return (
    <>
      <section className="admin-heading">
        <div>
          <span className="kicker">Plans</span>
          <h1 className="admin-title">Pricing</h1>
          <p>
            New prices apply to every checkout within 30 seconds. Orders already
            started keep the price they were created with.
          </p>
        </div>
      </section>
      <div className="admin-price-grid">
        {CURRENCIES.map((currency) => (
          <PriceCard
            key={`${currency}-${prices.current[currency].join()}`}
            currency={currency}
            prices={prices}
            onSaved={onSaved}
            onError={onError}
          />
        ))}
      </div>
      <p className="admin-footnote">
        The marketing page picks up new prices automatically. Some FAQ answers
        on the site still quote the default prices in their text.
      </p>
    </>
  );
}

function PriceCard({
  currency,
  prices,
  onSaved,
  onError,
}: {
  currency: Currency;
  prices: Prices;
  onSaved: (prices: Prices, text: string) => void;
  onError: (text: string) => void;
}) {
  const current = prices.current[currency];
  const defaults = prices.defaults[currency];
  const [values, setValues] = useState(
    current.map((amount) => String(amount / 100)),
  );
  const [saving, setSaving] = useState(false);
  const parsed = values.map((value) => Number(value));
  const valid = parsed.every(
    (value) => Number.isInteger(value) && value >= 1 && value <= 1_000_000,
  );
  const changed = parsed.some((value, index) => value * 100 !== current[index]);
  const isDefault = current.every(
    (amount, index) => amount === defaults[index],
  );
  const preview = valid ? previewPlans(parsed as PriceSet) : null;
  const symbol = currency === 'INR' ? '₹' : '$';

  async function save(next: PriceSet | null) {
    if (
      next === null &&
      !window.confirm(`Reset ${currency} prices to the defaults?`)
    )
      return;
    setSaving(true);
    try {
      const result = await send<Prices>(`/admin/prices/${currency}`, 'PUT', {
        prices: next,
      });
      onSaved(
        result,
        next ? `${currency} prices saved.` : `${currency} prices reset.`,
      );
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'Could not save prices.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-card admin-price-card">
      <div className="admin-card-head">
        <h2>
          {currency === 'INR' ? '₹ Rupees' : '$ US dollars'}
          <small>
            {currency === 'INR' ? 'Buyers in India' : 'Everyone else'}
          </small>
        </h2>
        <span className={`admin-pill ${isDefault ? '' : 'is-premium'}`}>
          {isDefault ? 'Default' : 'Custom'}
        </span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && changed) void save(parsed as unknown as PriceSet);
        }}
      >
        {PLAN_NAMES.map((name, index) => (
          <label key={name} className="admin-price-row">
            <span>
              <strong>{name}</strong>
              <small>
                {index === 1
                  ? '+15 days free'
                  : index === 2
                    ? '+1 month free'
                    : 'Base rate'}
              </small>
            </span>
            <span className="admin-price-input">
              <em>{symbol}</em>
              <input
                inputMode="numeric"
                value={values[index]}
                onChange={(event) =>
                  setValues((current) =>
                    current.map((value, at) =>
                      at === index
                        ? event.target.value.replace(/\D/g, '')
                        : value,
                    ),
                  )
                }
                aria-label={`${name} price in ${currency}`}
              />
            </span>
            <span className="admin-price-meta">
              {preview ? (
                <>
                  {preview[index]!.savePercent > 0 && (
                    <b>Save {preview[index]!.savePercent}%</b>
                  )}
                  {symbol}
                  {preview[index]!.perMonth.toFixed(currency === 'INR' ? 0 : 2)}
                  /mo
                </>
              ) : (
                '—'
              )}
            </span>
          </label>
        ))}
        {!valid && (
          <p className="admin-field-error">
            Use whole numbers between 1 and 1,000,000.
          </p>
        )}
        <div className="admin-price-actions">
          <button
            type="button"
            className="button ghost small"
            disabled={saving || isDefault}
            onClick={() => void save(null)}
          >
            Reset to defaults (
            {defaults.map((amount) => `${symbol}${amount / 100}`).join(' · ')})
          </button>
          <button
            className="button primary small"
            disabled={saving || !valid || !changed}
          >
            {saving ? 'Saving…' : 'Save prices'}
          </button>
        </div>
      </form>
    </section>
  );
}

function UserDrawer({
  user,
  me,
  now,
  onClose,
  onChanged,
  onDeleted,
}: {
  user: AdminUser;
  me: string;
  now: number;
  onClose: () => void;
  onChanged: (text: string) => Promise<void>;
  onDeleted: (text: string) => Promise<void>;
}) {
  const [months, setMonths] = useState(3);
  const [days, setDays] = useState(0);
  const [method, setMethod] = useState<GrantMethod>('complimentary');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const premium = statusFor(user, now) === 'Premium';
  const isSelf = user.email === me;
  const path = `/admin/users/${encodeURIComponent(user.id)}`;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(
    label: string,
    work: () => Promise<unknown>,
    done: () => Promise<void>,
  ) {
    setWorking(label);
    setError('');
    try {
      await work();
      await done();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That didn’t work.');
    } finally {
      setWorking('');
    }
  }

  return (
    <div
      className="admin-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="admin-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-drawer-title"
      >
        <header className="admin-drawer-head">
          <Avatar user={user} />
          <div>
            <h2 id="admin-drawer-title">{user.name}</h2>
            <p>{user.email}</p>
          </div>
          <button className="admin-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="admin-facts">
          <div>
            <span>Presence</span>
            <strong
              className={`admin-presence ${user.online ? 'is-online' : ''}`}
            >
              <i />
              {user.online ? 'Online now' : ago(user.lastSeenAt, now)}
            </strong>
          </div>
          <div>
            <span>Access</span>
            <strong>
              {statusFor(user, now)}
              {premium && <small> until {dateTime(user.paidUntil)}</small>}
            </strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{user.emailVerified ? 'Verified' : 'Not verified'}</strong>
          </div>
          <div>
            <span>Joined</span>
            <strong>{dateTime(user.createdAt)}</strong>
          </div>
          <div>
            <span>Boards owned</span>
            <strong>{user.boardCount}</strong>
          </div>
          <div>
            <span>Role</span>
            <strong>{user.role === 'admin' ? 'Admin' : 'User'}</strong>
          </div>
        </div>
        <div className="admin-user-id">
          <span>User ID</span>
          <code>{user.id}</code>
          <button
            className="button ghost small"
            onClick={() => void navigator.clipboard?.writeText(user.id)}
          >
            Copy
          </button>
        </div>

        {error && (
          <div className="admin-alert" role="alert">
            {error}
          </div>
        )}

        <div className="admin-quick">
          {!user.emailVerified && (
            <button
              className="button primary small"
              disabled={Boolean(working)}
              onClick={() =>
                void run(
                  'verify',
                  () => send(`${path}/verify`, 'POST', {}),
                  () => onChanged(`${user.email} is now verified.`),
                )
              }
            >
              {working === 'verify' ? 'Verifying…' : '✓ Verify email'}
            </button>
          )}
          {user.emailVerified && (
            <button
              className="button ghost small"
              disabled={Boolean(working)}
              onClick={() => {
                if (
                  !window.confirm(
                    `Mark ${user.email} as unverified? They’ll need to confirm their email with a new code before they can upgrade.`,
                  )
                )
                  return;
                void run(
                  'unverify',
                  () => send(`${path}/unverify`, 'POST', {}),
                  () => onChanged(`${user.email} is now unverified.`),
                );
              }}
            >
              {working === 'unverify' ? 'Updating…' : 'Mark unverified'}
            </button>
          )}
          {premium && (
            <button
              className="button danger small"
              disabled={Boolean(working)}
              onClick={() => {
                if (
                  !window.confirm(
                    `Revoke Premium for ${user.name}? Premium ends immediately and is not refunded.`,
                  )
                )
                  return;
                void run(
                  'revoke',
                  () => send(`${path}/revoke`, 'POST', {}),
                  () => onChanged(`Premium revoked for ${user.email}.`),
                );
              }}
            >
              {working === 'revoke' ? 'Revoking…' : 'Revoke Premium'}
            </button>
          )}
        </div>

        <form
          className="admin-grant-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              'grant',
              () =>
                send(`${path}/grants`, 'POST', {
                  months,
                  days,
                  method,
                  ...(reference.trim() ? { reference: reference.trim() } : {}),
                  ...(note.trim() ? { note: note.trim() } : {}),
                }),
              () => onChanged(`Premium granted to ${user.email}.`),
            );
          }}
        >
          <h3>{premium ? 'Extend Premium' : 'Give Premium'}</h3>
          <p>Adds to any Premium time they already have.</p>
          <div className="admin-presets">
            {[
              [1, 0, '1 month'],
              [3, 0, '3 months'],
              [6, 15, '6 mo + 15 d'],
              [13, 0, '1 year + 1 mo'],
            ].map(([m, d, label]) => (
              <button
                type="button"
                key={label}
                className={`admin-chip ${months === m && days === d ? 'is-active' : ''}`}
                onClick={() => {
                  setMonths(m as number);
                  setDays(d as number);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="admin-grant-duration">
            <label>
              Months
              <input
                type="number"
                min="0"
                max="120"
                value={months}
                onChange={(event) => setMonths(Number(event.target.value))}
              />
            </label>
            <label>
              Extra days
              <input
                type="number"
                min="0"
                max="365"
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              />
            </label>
            <label>
              Reason
              <select
                value={method}
                onChange={(event) =>
                  setMethod(event.target.value as GrantMethod)
                }
              >
                <option value="complimentary">Complimentary</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <label>
            <span>
              Reference <span className="admin-optional">Optional</span>
            </span>
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              maxLength={120}
              placeholder="Receipt or transaction number"
            />
          </label>
          <label>
            <span>
              Note <span className="admin-optional">Optional</span>
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Why this access was given"
            />
          </label>
          <button
            className="button primary wide"
            disabled={Boolean(working) || (months === 0 && days === 0)}
          >
            {working === 'grant'
              ? 'Saving…'
              : premium
                ? 'Extend Premium'
                : 'Give Premium'}
          </button>
        </form>

        <div className="admin-history">
          <h3>Payments</h3>
          {user.payments.length ? (
            <ul>
              {user.payments.map((payment, index) => (
                <li key={`${payment.provider}-${payment.createdAt}-${index}`}>
                  <div>
                    <strong>
                      {paymentTerm(payment)} · {methodLabel(payment.provider)}
                    </strong>
                    <span>{dateTime(payment.paidAt ?? payment.createdAt)}</span>
                  </div>
                  <div>
                    <strong>{money(payment.amount, payment.currency)}</strong>
                    <span>
                      {payment.refundedAt ? 'Refunded' : payment.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p>No payments on this account.</p>
          )}
          {user.grants.length > 0 && (
            <>
              <h3>Manual grants</h3>
              <ul>
                {user.grants.map((grant) => (
                  <li key={grant.id}>
                    <div>
                      <strong>
                        {shortTerm(grant.months, grant.days)} ·{' '}
                        {methodLabel(grant.method)}
                      </strong>
                      <span>
                        {dateTime(grant.createdAt)} by {grant.adminUsername}
                      </span>
                      {grant.note && <span>{grant.note}</span>}
                      {grant.reference && <span>Ref: {grant.reference}</span>}
                    </div>
                    <div>
                      <span>Through</span>
                      <strong>{dateTime(grant.paidUntil)}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="admin-danger">
          <h3>Remove this account</h3>
          {isSelf || user.role === 'admin' ? (
            <p>
              {isSelf
                ? 'You can’t remove the account you’re signed in with.'
                : 'Admin accounts can’t be removed from the console.'}
            </p>
          ) : (
            <>
              <p>
                Deletes the account, its sessions and the {user.boardCount}{' '}
                board{user.boardCount === 1 ? '' : 's'} it owns. Payment records
                are kept. This can’t be undone.
              </p>
              <label>
                Type <code>{user.email}</code> to confirm
                <input
                  value={confirmDelete}
                  onChange={(event) => setConfirmDelete(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <button
                className="button danger small"
                disabled={
                  Boolean(working) ||
                  confirmDelete.trim().toLowerCase() !== user.email
                }
                onClick={() =>
                  void run(
                    'delete',
                    () => send(path, 'DELETE'),
                    () => onDeleted(`${user.email} was removed.`),
                  )
                }
              >
                {working === 'delete' ? 'Removing…' : 'Remove account'}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function AddUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (text: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verified, setVerified] = useState(true);
  const [premiumMonths, setPremiumMonths] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function generate() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    setPassword(
      Array.from(bytes, (byte) =>
        'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.charAt(
          byte % 55,
        ),
      ).join(''),
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await send('/admin/users', 'POST', {
        name: name.trim(),
        email: email.trim(),
        password,
        verified,
        premiumMonths,
      });
      await onCreated(`${email.trim()} was added.`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not add user.',
      );
      setSaving(false);
    }
  }

  return (
    <div
      className="admin-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-add-title"
      >
        <div className="admin-modal-head">
          <div>
            <span className="kicker">Accounts</span>
            <h2 id="admin-add-title">Add a user</h2>
            <p>They can sign in straight away with this email and password.</p>
          </div>
          <button className="admin-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <form className="admin-grant-form" onSubmit={submit}>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={48}
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <span className="admin-inline">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                className="button ghost small"
                onClick={generate}
              >
                Generate
              </button>
            </span>
          </label>
          <div className="admin-grant-duration">
            <label>
              Premium to start with
              <select
                value={premiumMonths}
                onChange={(event) =>
                  setPremiumMonths(Number(event.target.value))
                }
              >
                <option value={0}>None</option>
                <option value={1}>1 month</option>
                <option value={3}>3 months</option>
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
              </select>
            </label>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
              />
              Email already verified
            </label>
          </div>
          {error && (
            <div className="admin-alert" role="alert">
              {error}
            </div>
          )}
          <button className="button primary wide" disabled={saving}>
            {saving ? 'Adding…' : 'Add user'}
          </button>
          <p className="admin-muted">
            Share the password with them privately; they can change it from
            their profile.
          </p>
        </form>
      </section>
    </div>
  );
}

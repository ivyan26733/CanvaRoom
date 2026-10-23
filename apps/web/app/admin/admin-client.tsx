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
  trialUsedSeconds: number;
  paidUntil: string | null;
  paymentCount: number;
  payments: AdminPayment[];
  grants: AdminGrant[];
};
type UserPage = { total: number; users: AdminUser[] };
type AdminMe = {
  authenticated: boolean;
  configured: boolean;
  username?: string;
};
type GrantMethod = 'cash' | 'bank_transfer' | 'complimentary' | 'other';

const PAGE_SIZE = 50;
const seconds = 30 * 60;
const dateTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value)) + ' UTC'
    : '—';
const statusFor = (user: AdminUser, now = Date.now()) => {
  if (user.paidUntil && Date.parse(user.paidUntil) > now) return 'Premium';
  return user.trialUsedSeconds < seconds ? 'Trial' : 'Free';
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
const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
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

export default function AdminClient() {
  const [checked, setChecked] = useState(false);
  const [now, setNow] = useState(0);
  const [authenticated, setAuthenticated] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [months, setMonths] = useState(3);
  const [days, setDays] = useState(0);
  const [method, setMethod] = useState<GrantMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [grantError, setGrantError] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

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

  const loadUsers = useCallback(async () => {
    if (!authenticated) return;
    setListError('');
    try {
      const params = new URLSearchParams({
        q: query,
        page: String(page),
        limit: String(PAGE_SIZE),
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
      if (error instanceof ApiError && error.status === 401)
        setAuthenticated(false);
      setListError(
        error instanceof Error ? error.message : 'Could not load accounts.',
      );
    }
  }, [authenticated, page, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 180);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  const stats = useMemo(
    () => ({
      premium: users.filter((user) => statusFor(user, now) === 'Premium')
        .length,
      unverified: users.filter((user) => !user.emailVerified).length,
      active: users.filter(
        (user) =>
          user.lastSeenAt && now - Date.parse(user.lastSeenAt) < 120_000,
      ).length,
    }),
    [now, users],
  );

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

  function openGrant(user: AdminUser) {
    setSelected(user);
    setMonths(3);
    setDays(0);
    setMethod('cash');
    setReference('');
    setNote('');
    setGrantError('');
  }

  async function submitGrant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setGrantBusy(true);
    setGrantError('');
    try {
      await send(
        `/admin/users/${encodeURIComponent(selected.id)}/grants`,
        'POST',
        {
          months,
          days,
          method,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      );
      await loadUsers();
      setGrantError('Premium access updated and recorded.');
      window.setTimeout(() => setSelected(null), 900);
    } catch (error) {
      setGrantError(
        error instanceof Error ? error.message : 'Could not update access.',
      );
    } finally {
      setGrantBusy(false);
    }
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
    <main className="admin-page">
      <header className="admin-topbar">
        <a className="admin-brand" href="/" aria-label="CanvaRoom home">
          <span className="admin-brand-mark">C</span> CanvaRoom
        </a>
        <div className="admin-topbar-right">
          <span className="admin-area-label">Admin console</span>
          <button className="button ghost small" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>
      <div className="admin-content">
        <section className="admin-heading">
          <div>
            <span className="kicker">Account operations</span>
            <h1>Users</h1>
            <p>Review accounts, payment history, and Premium access.</p>
          </div>
          <span className="admin-session-label">
            Signed in as {username || 'administrator'}
          </span>
        </section>
        <section className="admin-stats" aria-label="Current page summary">
          <div className="admin-stat">
            <span>Registered users</span>
            <strong>{total.toLocaleString()}</strong>
            <small>Across all pages</small>
          </div>
          <div className="admin-stat">
            <span>Premium on this page</span>
            <strong>{stats.premium}</strong>
            <small>Access has not expired</small>
          </div>
          <div className="admin-stat">
            <span>Recently active</span>
            <strong>{stats.active}</strong>
            <small>Seen in the last 2 minutes</small>
          </div>
          <div className="admin-stat">
            <span>Unverified on this page</span>
            <strong>{stats.unverified}</strong>
            <small>Email not verified</small>
          </div>
        </section>
        <section className="admin-directory">
          <div className="admin-directory-head">
            <div>
              <h2>Registered accounts</h2>
              <p>Search by name, email, or user ID.</p>
            </div>
            <label className="admin-search">
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search accounts"
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
                  <th>Role</th>
                  <th>Verified</th>
                  <th>Access</th>
                  <th>Last seen</th>
                  <th>Payments</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const entitlement = statusFor(user, now);
                  const recent = user.payments[0];
                  const online = Boolean(
                    user.lastSeenAt &&
                    now - Date.parse(user.lastSeenAt) < 120_000,
                  );
                  return (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.name}</strong>
                        <span className="admin-secondary">{user.email}</span>
                        <code title={user.id}>{user.id}</code>
                      </td>
                      <td>
                        <span
                          className={`admin-pill ${user.role === 'admin' ? 'is-premium' : ''}`}
                        >
                          {user.role === 'admin' ? 'Admin' : 'User'}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`admin-pill ${user.emailVerified ? 'is-good' : 'is-waiting'}`}
                        >
                          {user.emailVerified ? 'Verified' : 'Pending'}
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
                            : `Joined ${dateTime(user.createdAt)}`}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`admin-presence ${online ? 'is-online' : ''}`}
                        >
                          <i />
                          {online ? 'Active now' : dateTime(user.lastSeenAt)}
                        </span>
                      </td>
                      <td>
                        {(() => {
                          const latestGrant = user.grants[0];
                          const grantIsLatest =
                            latestGrant &&
                            (!recent ||
                              Date.parse(latestGrant.createdAt) >
                                Date.parse(recent.createdAt));
                          if (grantIsLatest)
                            return (
                              <>
                                <strong>Manual access</strong>
                                <span className="admin-secondary">
                                  {methodLabel(latestGrant.method)} ·{' '}
                                  {shortTerm(
                                    latestGrant.months,
                                    latestGrant.days,
                                  )}
                                </span>
                                <span className="admin-secondary">
                                  Through {dateTime(latestGrant.paidUntil)}
                                </span>
                              </>
                            );
                          if (recent)
                            return (
                              <>
                                <strong>
                                  {recent.status === 'paid' &&
                                  !recent.refundedAt
                                    ? 'Paid'
                                    : recent.refundedAt
                                      ? 'Refunded'
                                      : 'Pending'}
                                </strong>
                                <span className="admin-secondary">
                                  {methodLabel(recent.provider)} ·{' '}
                                  {money(recent.amount, recent.currency)}
                                </span>
                                <span className="admin-secondary">
                                  {paymentTerm(recent)} · {user.paymentCount}{' '}
                                  payment record
                                  {user.paymentCount === 1 ? '' : 's'}
                                </span>
                              </>
                            );
                          return (
                            <span className="admin-secondary">
                              No payments or grants
                            </span>
                          );
                        })()}
                      </td>
                      <td>
                        <button
                          className="button ghost small"
                          onClick={() => openGrant(user)}
                        >
                          Manage access
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!users.length && !listError && (
              <div className="admin-empty">
                {query
                  ? 'No accounts match that search.'
                  : 'No registered accounts yet.'}
              </div>
            )}
          </div>
          <div className="admin-pagination">
            <span>
              Showing{' '}
              {total ? ((page - 1) * PAGE_SIZE + 1).toLocaleString() : '0'}–
              {Math.min(page * PAGE_SIZE, total).toLocaleString()} of{' '}
              {total.toLocaleString()}
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
        <p className="admin-footnote">
          User information is restricted to this admin session. Premium grants
          are recorded with their reason and payment method.
        </p>
      </div>

      {selected && (
        <div
          className="admin-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <section
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-modal-title"
          >
            <div className="admin-modal-head">
              <div>
                <span className="kicker">Access management</span>
                <h2 id="admin-modal-title">{selected.name}</h2>
                <p>{selected.email}</p>
              </div>
              <button
                className="admin-close"
                aria-label="Close"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
            <div className="admin-user-id">
              <span>User ID</span>
              <code>{selected.id}</code>
              <button
                className="button ghost small"
                onClick={() => void navigator.clipboard?.writeText(selected.id)}
              >
                Copy
              </button>
            </div>
            <div className="admin-modal-summary">
              <div>
                <span>Role</span>
                <strong>{selected.role === 'admin' ? 'Admin' : 'User'}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>
                  {selected.emailVerified ? 'Verified' : 'Not verified'}
                </strong>
              </div>
              <div>
                <span>Current access</span>
                <strong>
                  {statusFor(selected)}
                  {statusFor(selected) === 'Premium'
                    ? ` · ${dateTime(selected.paidUntil)}`
                    : ''}
                </strong>
              </div>
              <div>
                <span>Last seen</span>
                <strong>{dateTime(selected.lastSeenAt)}</strong>
              </div>
            </div>
            <form className="admin-grant-form" onSubmit={submitGrant}>
              <h3>Grant Premium access</h3>
              <p>Duration adds on to any unexpired Premium time.</p>
              <div className="admin-grant-duration">
                <label>
                  Months
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={months}
                    onChange={(event) => setMonths(Number(event.target.value))}
                    required
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
                    required
                  />
                </label>
              </div>
              <label>
                Payment method / reason
                <select
                  value={method}
                  onChange={(event) =>
                    setMethod(event.target.value as GrantMethod)
                  }
                >
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="complimentary">Complimentary access</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Receipt or reference{' '}
                <span className="admin-optional">Optional</span>
                <input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  maxLength={120}
                  placeholder="Reference number"
                />
              </label>
              <label>
                Admin note <span className="admin-optional">Optional</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Reason for this access change"
                />
              </label>
              {grantError && (
                <div
                  className={`admin-alert ${grantError.startsWith('Premium access') ? 'is-success' : ''}`}
                  role="status"
                >
                  {grantError}
                </div>
              )}
              <button
                className="button primary wide"
                disabled={grantBusy || (months === 0 && days === 0)}
              >
                {grantBusy ? 'Saving access…' : 'Grant Premium'}
              </button>
            </form>
            <div className="admin-history">
              <h3>Recent payment records</h3>
              {selected.payments.length ? (
                <ul>
                  {selected.payments.map((payment, index) => (
                    <li
                      key={`${payment.provider}-${payment.createdAt}-${index}`}
                    >
                      <div>
                        <strong>
                          {paymentTerm(payment)} ·{' '}
                          {methodLabel(payment.provider)}
                        </strong>
                        <span>
                          {dateTime(payment.paidAt ?? payment.createdAt)}
                        </span>
                      </div>
                      <div>
                        <strong>
                          {money(payment.amount, payment.currency)}
                        </strong>
                        <span>
                          {payment.refundedAt ? 'Refunded' : payment.status}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No payment records are attached to this account.</p>
              )}
              {selected.grants.length > 0 && (
                <>
                  <h3>Manual Premium grants</h3>
                  <ul>
                    {selected.grants.map((grant) => (
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
                          {grant.reference && (
                            <span>Ref: {grant.reference}</span>
                          )}
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
          </section>
        </div>
      )}
    </main>
  );
}

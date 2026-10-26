'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, send } from '../lib/api';
import { NOTICE_KINDS, noticeWhen, type Notice } from '../lib/notices';

/**
 * Notices for everyone: write one before maintenance, downtime or a repair,
 * and it shows as a banner across the site (and on boards) and on /status.
 */

type Draft = {
  id?: string;
  kind: Notice['kind'];
  title: string;
  message: string;
  startsAt: string;
  endsAt: string;
  showFrom: string;
  showUntil: string;
  published: boolean;
};

/** Ready-made wording for the usual cases; everything can be edited. */
const TEMPLATES: { label: string; draft: Partial<Draft> }[] = [
  {
    label: '🛠️ Maintenance',
    draft: {
      kind: 'maintenance',
      title: 'Scheduled maintenance',
      message:
        'We’re upgrading CanvaRoom to make it faster. Boards may be unavailable for a few minutes; anything you draw before it starts is saved. Thanks for your patience!',
    },
  },
  {
    label: '⏸️ Planned downtime',
    draft: {
      kind: 'maintenance',
      title: 'CanvaRoom will be briefly offline',
      message:
        'We’re moving to new servers. CanvaRoom will be offline during this window. Please save your work and avoid starting a class at this time.',
    },
  },
  {
    label: '🚨 Issue / repair',
    draft: {
      kind: 'outage',
      title: 'We’re fixing a problem',
      message:
        'Some people may have trouble opening boards or saving. We’re on it and will update this notice as soon as it’s fixed.',
    },
  },
  {
    label: '✅ Resolved',
    draft: {
      kind: 'update',
      title: 'All fixed',
      message:
        'The earlier problem is fixed and everything is working normally. Sorry for the trouble!',
    },
  },
  {
    label: '📣 Announcement',
    draft: { kind: 'info', title: '', message: '' },
  },
];

const EMPTY: Draft = {
  kind: 'maintenance',
  title: '',
  message: '',
  startsAt: '',
  endsAt: '',
  showFrom: '',
  showUntil: '',
  published: false,
};

/** ISO → the value a datetime-local input takes, in this browser's time. */
function toLocalInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const fromLocalInput = (value: string) =>
  value ? new Date(value).toISOString() : null;

const stamp = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value))
    : '—';

function stateOf(notice: Notice, now: number) {
  if (!notice.published) return { label: 'Draft', tone: '' };
  if (Date.parse(notice.showFrom) > now)
    return { label: 'Scheduled', tone: 'is-waiting' };
  if (notice.showUntil && Date.parse(notice.showUntil) <= now)
    return { label: 'Ended', tone: '' };
  return { label: 'Live', tone: 'is-good' };
}

export function NoticesSection({
  onUnauthorized,
  onToast,
}: {
  onUnauthorized: () => void;
  onToast: (text: string, error?: boolean) => void;
}) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      setNotices((await api<{ notices: Notice[] }>('/admin/notices')).notices);
      // Judge Live / Scheduled against the time the list was fetched.
      setNow(Date.now());
      setError('');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized();
      setError(
        caught instanceof Error ? caught.message : 'Could not load notices.',
      );
    }
  }, [onUnauthorized]);

  useEffect(() => {
    setNow(Date.now());
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function save(next: Draft, publish: boolean) {
    setSaving(true);
    try {
      const body = {
        kind: next.kind,
        title: next.title,
        message: next.message,
        startsAt: fromLocalInput(next.startsAt),
        endsAt: fromLocalInput(next.endsAt),
        showFrom: fromLocalInput(next.showFrom),
        showUntil: fromLocalInput(next.showUntil),
        published: publish,
      };
      await send(
        next.id
          ? `/admin/notices/${encodeURIComponent(next.id)}`
          : '/admin/notices',
        next.id ? 'PUT' : 'POST',
        body,
      );
      onToast(
        publish
          ? 'Published. Everyone will see it within a few minutes.'
          : 'Saved as a draft. Nobody sees it yet.',
      );
      setDraft(null);
      await load();
    } catch (caught) {
      onToast(
        caught instanceof Error ? caught.message : 'Could not save.',
        true,
      );
    } finally {
      setSaving(false);
    }
  }

  async function setPublished(notice: Notice, published: boolean) {
    const next = fromNotice(notice);
    await save(next, published);
  }

  async function remove(notice: Notice) {
    if (
      !window.confirm(`Delete “${notice.title}”? It disappears for everyone.`)
    )
      return;
    try {
      await send(`/admin/notices/${encodeURIComponent(notice.id)}`, 'DELETE');
      onToast('Notice deleted.');
      await load();
    } catch (caught) {
      onToast(
        caught instanceof Error ? caught.message : 'Could not delete.',
        true,
      );
    }
  }

  return (
    <>
      <section className="admin-heading">
        <div>
          <span className="kicker">Tell everyone</span>
          <h1 className="admin-title">Notices</h1>
          <p>
            Before maintenance, downtime or a repair, post a notice. It shows as
            a banner on every page and board, and on the{' '}
            <a href="/status" target="_blank" rel="noreferrer">
              status page
            </a>
            .
          </p>
        </div>
        <button
          className="button primary"
          onClick={() =>
            setDraft({
              ...EMPTY,
              ...TEMPLATES[0]!.draft,
            })
          }
        >
          + New notice
        </button>
      </section>
      {error && (
        <div className="admin-alert" role="alert">
          {error}
        </div>
      )}

      {draft && (
        <NoticeEditor
          draft={draft}
          saving={saving}
          now={now}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={(publish) => void save(draft, publish)}
        />
      )}

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>All notices</h2>
        </div>
        {notices?.length ? (
          <ul className="nt-list">
            {notices.map((notice) => {
              const state = stateOf(notice, now);
              const kind = NOTICE_KINDS[notice.kind];
              return (
                <li key={notice.id}>
                  <div className="nt-main">
                    <div className="nt-title">
                      <span aria-hidden="true">{kind.emoji}</span>
                      <strong>{notice.title}</strong>
                      <span className={`admin-pill ${state.tone}`}>
                        {state.label}
                      </span>
                    </div>
                    {notice.startsAt && (
                      <p className="nt-when">{noticeWhen(notice, now)}</p>
                    )}
                    {notice.message && (
                      <p className="admin-secondary nt-message">
                        {notice.message}
                      </p>
                    )}
                    <p className="admin-secondary">
                      Banner {stamp(notice.showFrom)} →{' '}
                      {notice.showUntil
                        ? stamp(notice.showUntil)
                        : 'until removed'}{' '}
                      · by {notice.createdBy}
                    </p>
                  </div>
                  <div className="nt-actions">
                    <button
                      className="button ghost small"
                      onClick={() => setDraft(fromNotice(notice))}
                    >
                      Edit
                    </button>
                    {notice.published ? (
                      <button
                        className="button ghost small"
                        onClick={() => void setPublished(notice, false)}
                      >
                        Unpublish
                      </button>
                    ) : (
                      <button
                        className="button primary small"
                        onClick={() => void setPublished(notice, true)}
                      >
                        Publish
                      </button>
                    )}
                    <button
                      className="button danger small"
                      onClick={() => void remove(notice)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="admin-muted">
            {notices ? 'No notices yet.' : 'Loading…'}
          </p>
        )}
      </section>
    </>
  );
}

function fromNotice(notice: Notice): Draft {
  return {
    id: notice.id,
    kind: notice.kind,
    title: notice.title,
    message: notice.message,
    startsAt: toLocalInput(notice.startsAt),
    endsAt: toLocalInput(notice.endsAt),
    showFrom: toLocalInput(notice.showFrom),
    showUntil: toLocalInput(notice.showUntil),
    published: notice.published,
  };
}

function NoticeEditor({
  draft,
  saving,
  now,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  saving: boolean;
  now: number;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSave: (publish: boolean) => void;
}) {
  const set = (fields: Partial<Draft>) => onChange({ ...draft, ...fields });
  const preview: Notice = {
    id: 'preview',
    kind: draft.kind,
    title: draft.title || 'Your title',
    message: draft.message,
    startsAt: fromLocalInput(draft.startsAt),
    endsAt: fromLocalInput(draft.endsAt),
    showFrom: fromLocalInput(draft.showFrom) ?? new Date(now).toISOString(),
    showUntil: fromLocalInput(draft.showUntil),
    published: true,
    updatedAt: '',
  };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <section className="admin-card nt-editor">
      <div className="admin-card-head">
        <h2>{draft.id ? 'Edit notice' : 'New notice'}</h2>
        <span className="admin-secondary">Times are in your zone: {zone}</span>
      </div>
      {!draft.id && (
        <div className="admin-chips nt-templates">
          {TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              className="admin-chip"
              onClick={() => set(template.draft)}
            >
              {template.label}
            </button>
          ))}
        </div>
      )}
      <form
        className="admin-grant-form nt-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(true);
        }}
      >
        <div className="nt-row">
          <label>
            Type
            <select
              value={draft.kind}
              onChange={(event) =>
                set({ kind: event.target.value as Notice['kind'] })
              }
            >
              {Object.entries(NOTICE_KINDS).map(([id, kind]) => (
                <option key={id} value={id}>
                  {kind.emoji} {kind.label}
                </option>
              ))}
            </select>
          </label>
          <label className="nt-grow">
            Title
            <input
              value={draft.title}
              onChange={(event) => set({ title: event.target.value })}
              maxLength={120}
              required
              placeholder="Scheduled maintenance"
            />
          </label>
        </div>
        <label>
          Message <span className="admin-optional">Optional</span>
          <textarea
            value={draft.message}
            onChange={(event) => set({ message: event.target.value })}
            maxLength={1000}
            rows={3}
            placeholder="What will happen, and what people should do."
          />
        </label>
        <div className="nt-row">
          <label>
            Work starts <span className="admin-optional">Optional</span>
            <input
              type="datetime-local"
              value={draft.startsAt}
              onChange={(event) => set({ startsAt: event.target.value })}
            />
          </label>
          <label>
            Work ends <span className="admin-optional">Optional</span>
            <input
              type="datetime-local"
              value={draft.endsAt}
              onChange={(event) => set({ endsAt: event.target.value })}
            />
          </label>
        </div>
        <div className="nt-row">
          <label>
            Show banner from <span className="admin-optional">Empty = now</span>
            <input
              type="datetime-local"
              value={draft.showFrom}
              onChange={(event) => set({ showFrom: event.target.value })}
            />
          </label>
          <label>
            Hide banner after{' '}
            <span className="admin-optional">
              Empty = 2 h after the work ends, or never
            </span>
            <input
              type="datetime-local"
              value={draft.showUntil}
              onChange={(event) => set({ showUntil: event.target.value })}
            />
          </label>
        </div>
        <div className="nt-preview">
          <span className="admin-secondary">Preview</span>
          <div className={`site-notice is-${preview.kind}`}>
            <span className="site-notice-icon" aria-hidden="true">
              {NOTICE_KINDS[preview.kind].emoji}
            </span>
            <div className="site-notice-body">
              <p>
                <strong>{preview.title}</strong>
                {preview.startsAt && (
                  <span className="site-notice-when">
                    {noticeWhen(preview, now)}
                  </span>
                )}
              </p>
              {preview.message && (
                <p className="site-notice-message">{preview.message}</p>
              )}
            </div>
            <span className="site-notice-link">Details</span>
          </div>
        </div>
        <div className="nt-buttons">
          <button
            type="button"
            className="button ghost small"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button ghost small"
            disabled={saving || !draft.title.trim()}
            onClick={() => onSave(false)}
          >
            Save as draft
          </button>
          <button
            className="button primary small"
            disabled={saving || !draft.title.trim()}
          >
            {saving ? 'Saving…' : 'Publish'}
          </button>
        </div>
      </form>
    </section>
  );
}

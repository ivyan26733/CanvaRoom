'use client';

import { useEffect, useState } from 'react';
import { send } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Icon } from './icons';
import { Modal } from './modal';

const CATEGORIES = [
  { id: 'idea', label: 'Idea' },
  { id: 'bug', label: 'Something broke' },
  { id: 'praise', label: 'Praise' },
  { id: 'question', label: 'Question' },
  { id: 'other', label: 'Other' },
] as const;

type Category = (typeof CATEGORIES)[number]['id'];

const MAX_LENGTH = 4000;

/** Sends feedback to the team. Embedded on the contact page and in a dialog. */
export function FeedbackForm({ onSent }: { onSent?: () => void }) {
  const { user } = useAuth();
  const [category, setCategory] = useState<Category>('idea');
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  // Account holders are answered at their account email.
  const needsEmail = !user?.email;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await send('/feedback', 'POST', {
        message,
        category,
        ...(rating ? { rating } : {}),
        ...(needsEmail ? { email } : {}),
        page: location.pathname,
      });
      setSent(true);
      onSent?.();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div className="feedback-sent" role="status">
        <Icon name="check" size={22} />
        <div>
          <strong>Thank you — it’s with us.</strong>
          <p>
            We read every note. If it needs an answer, we’ll reply to{' '}
            {user?.email ?? email}.
          </p>
        </div>
        <button
          type="button"
          className="button ghost small"
          onClick={() => {
            setSent(false);
            setMessage('');
            setRating(null);
          }}
        >
          Send another
        </button>
      </div>
    );

  return (
    <form className="feedback-form" onSubmit={submit}>
      <fieldset className="feedback-kinds">
        <legend>What’s it about?</legend>
        {CATEGORIES.map((item) => (
          <label
            key={item.id}
            className={`feedback-kind ${category === item.id ? 'is-active' : ''}`}
          >
            <input
              type="radio"
              name="feedback-category"
              value={item.id}
              checked={category === item.id}
              onChange={() => setCategory(item.id)}
            />
            {item.label}
          </label>
        ))}
      </fieldset>

      <label className="auth-field">
        <span>Your feedback</span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="What worked, what didn’t, what you wish it did…"
          rows={5}
          maxLength={MAX_LENGTH}
          required
          minLength={3}
        />
        <small className="feedback-count">
          {message.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
        </small>
      </label>

      <fieldset className="feedback-rating">
        <legend>How’s Avenor so far? (optional)</legend>
        <div>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className={`feedback-star ${rating && value <= rating ? 'is-on' : ''}`}
              aria-label={`${value} out of 5`}
              aria-pressed={rating === value}
              onClick={() => setRating(rating === value ? null : value)}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>

      {needsEmail && (
        <label className="auth-field">
          <span>Your email, so we can reply</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
      )}

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="feedback-actions">
        <button
          className="button primary"
          type="submit"
          disabled={busy || message.trim().length < 3}
        >
          {busy ? 'Sending…' : 'Send feedback'}
        </button>
      </div>
    </form>
  );
}

/** Fired to open the feedback dialog from anywhere on the page. */
const FEEDBACK_EVENT = 'canvaroom:feedback';

export function openFeedback() {
  window.dispatchEvent(new CustomEvent(FEEDBACK_EVENT));
}

function FeedbackDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="feedback-modal">
      <p className="kicker">Feedback</p>
      <h2>Tell us how it’s going</h2>
      <p className="modal-copy">
        It goes straight to the people building Avenor.
      </p>
      <FeedbackForm />
    </Modal>
  );
}

/** Shows the feedback dialog when something on the page asks for it. */
export function FeedbackProvider() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(FEEDBACK_EVENT, show);
    return () => window.removeEventListener(FEEDBACK_EVENT, show);
  }, []);
  return open ? <FeedbackDialog onClose={() => setOpen(false)} /> : null;
}

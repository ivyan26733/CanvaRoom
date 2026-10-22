'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/icons';
import { Modal } from '../components/modal';
import { api, send, type User } from './api';
import { useAuth } from './auth';
import { longDate, planState } from './billing';

type Pass = {
  name: string;
  amount: number;
  listAmount: number;
  currency: string;
  days: number;
  interval: 'month';
};

type Order = {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  name: string;
};

type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayCheckout = {
  open(): void;
  on(
    event: 'payment.failed',
    handler: (response: { error?: { description?: string } }) => void,
  ): void;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

let checkoutScript: Promise<void> | undefined;

/** Loads Razorpay's checkout only when someone actually pays. */
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return (checkoutScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      checkoutScript = undefined;
      script.remove();
      reject(
        new Error(
          'The payment window couldn’t load. Check your connection or any ad blocker, then try again.',
        ),
      );
    };
    document.head.appendChild(script);
  }));
}

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: minor % 100 ? 2 : 0,
  }).format(minor / 100);

const INCLUDED = [
  'Unlimited boards, and as many people on each as you like',
  'Export to PNG, SVG and PDF',
  'Images on your boards',
  'Session recording in HD, up to 4K',
  'Follow-the-writer and voice for a whole class',
];

type Phase =
  | { step: 'idle'; message?: string; tone?: 'error' | 'info' }
  | { step: 'paying' }
  | { step: 'verifying' }
  | { step: 'done'; until: string };

export default function UpgradeDialog({
  reason,
  onClose,
}: {
  /** What the person just tried that needs Premium, if anything. */
  reason: string;
  onClose: () => void;
}) {
  const { user, setUser } = useAuth();
  const [pass, setPass] = useState<Pass | null>(null);
  const [available, setAvailable] = useState(true);
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const state = planState(user);

  useEffect(() => {
    api<{ available: boolean; pass: Pass }>('/billing/plan')
      .then((result) => {
        setPass(result.pass);
        setAvailable(result.available);
      })
      .catch(() => setAvailable(false));
  }, []);

  const verify = useCallback(
    async (response: RazorpaySuccess) => {
      setPhase({ step: 'verifying' });
      try {
        const result = await send<{ paidUntil?: string }>(
          '/billing/verify-payment',
          'POST',
          response,
        );
        const me = await api<{ user: User | null }>('/auth/me');
        setUser(me.user);
        setPhase({
          step: 'done',
          until: result.paidUntil ?? me.user?.plan?.paidUntil ?? '',
        });
      } catch (error) {
        setPhase({
          step: 'idle',
          tone: 'error',
          message: `${(error as Error).message} If money left your account, contact us with payment ID ${response.razorpay_payment_id}.`,
        });
      }
    },
    [setUser],
  );

  async function pay() {
    if (!user || user.guest) return;
    setPhase({ step: 'paying' });
    try {
      const [order] = await Promise.all([
        send<Order | { already_paid: true; paidUntil?: string }>(
          '/billing/create-order',
          'POST',
          {},
        ),
        loadCheckout(),
      ]);
      // An earlier payment that never reported back was found and applied.
      if ('already_paid' in order) {
        const me = await api<{ user: User | null }>('/auth/me');
        setUser(me.user);
        setPhase({
          step: 'done',
          until: order.paidUntil ?? me.user?.plan?.paidUntil ?? '',
        });
        return;
      }
      const checkout = new window.Razorpay!({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        order_id: order.order_id,
        name: 'CanvaRoom',
        description: order.name,
        prefill: { name: user.name, email: user.email ?? '' },
        theme: { color: '#ff4f1f' },
        handler: (response: RazorpaySuccess) => void verify(response),
        modal: {
          ondismiss: () =>
            setPhase((current) =>
              current.step === 'paying'
                ? {
                    step: 'idle',
                    tone: 'info',
                    message: 'Payment cancelled. You haven’t been charged.',
                  }
                : current,
            ),
        },
      });
      checkout.on('payment.failed', (response) =>
        setPhase({
          step: 'idle',
          tone: 'error',
          message: `Payment failed: ${response.error?.description ?? 'please try again or use another method.'}`,
        }),
      );
      checkout.open();
    } catch (error) {
      setPhase({
        step: 'idle',
        tone: 'error',
        message: (error as Error).message,
      });
    }
  }

  if (phase.step === 'done')
    return (
      <Modal onClose={onClose} className="upgrade-modal">
        <p className="kicker">You’re on Premium</p>
        <h2>Thank you!</h2>
        <p className="modal-copy">
          {phase.until
            ? `Premium runs until ${longDate(phase.until)}.`
            : 'Premium is active.'}{' '}
          Every board, export, image and recording is unlocked, and people can
          join your boards again.
        </p>
        <div className="modal-actions">
          <button className="button primary" onClick={onClose}>
            Back to work
          </button>
        </div>
      </Modal>
    );

  const busy = phase.step === 'paying' || phase.step === 'verifying';
  return (
    <Modal onClose={onClose} className="upgrade-modal">
      <p className="kicker">
        {state?.kind === 'free'
          ? 'Your free trial has ended'
          : state?.kind === 'premium'
            ? `Premium until ${longDate(state.until)}`
            : 'CanvaRoom Premium'}
      </p>
      <h2>
        {state?.kind === 'premium'
          ? 'Renew Premium for another month'
          : 'Teach without limits'}
      </h2>
      {reason && (
        <p className="notice upgrade-reason" role="status">
          {reason}
        </p>
      )}
      <p className="modal-copy">
        {user?.guest
          ? 'Create an account first, then upgrade to Premium for your own boards.'
          : state?.kind === 'premium'
            ? 'Paying again adds a month after your current one ends.'
            : 'Your boards stay yours either way. The free plan keeps your first board for you to use on your own.'}
      </p>
      {pass && (
        <div className="upgrade-price">
          {pass.listAmount > pass.amount && (
            <span className="upgrade-offer">Launch offer</span>
          )}
          <p>
            {pass.listAmount > pass.amount && (
              <s aria-label={`Was ${money(pass.listAmount, pass.currency)}`}>
                {money(pass.listAmount, pass.currency)}
              </s>
            )}
            <strong>{money(pass.amount, pass.currency)}</strong>
            <span>/ month</span>
          </p>
          <small>
            {pass.listAmount > pass.amount
              ? `We’re now offering it for ${money(pass.amount, pass.currency)} ${pass.currency} a month. `
              : ''}
            Billed monthly: each payment unlocks {pass.days} days, with no
            automatic renewal.
          </small>
        </div>
      )}
      <ul className="upgrade-list">
        {INCLUDED.map((item) => (
          <li key={item}>
            <Icon name="check" size={15} /> {item}
          </li>
        ))}
      </ul>
      {'message' in phase && phase.message && (
        <p
          className={`notice ${phase.tone === 'error' ? 'error' : ''}`}
          role={phase.tone === 'error' ? 'alert' : 'status'}
        >
          {phase.message}
        </p>
      )}
      <div className="modal-actions">
        <button className="button ghost" onClick={onClose}>
          Not now
        </button>
        <button
          className="button primary"
          disabled={busy || !available || !pass || !user || user.guest}
          onClick={() => void pay()}
        >
          {phase.step === 'verifying'
            ? 'Confirming payment…'
            : phase.step === 'paying'
              ? 'Opening checkout…'
              : !available
                ? 'Payments unavailable'
                : pass
                  ? `Pay ${money(pass.amount, pass.currency)}`
                  : 'Loading…'}
        </button>
      </div>
    </Modal>
  );
}

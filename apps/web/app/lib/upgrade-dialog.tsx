'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/icons';
import { Modal } from '../components/modal';
import { api, ApiError, send, type User } from './api';
import { useAuth } from './auth';
import { longDate, planState } from './billing';
import {
  formatMoney,
  formatRate,
  planBonus,
  planLength,
  type Currency,
  type PlanId,
  type PremiumPlan,
} from './pricing';

/** A plan as the server charges it. */
type Plan = PremiumPlan & { name: string };

/** How this visitor pays, from the server: by country, and account. */
type Billing = {
  available: boolean;
  currency: Currency;
  provider: 'razorpay' | 'paypal' | null;
  bankTransferAvailable: boolean;
  plans: Plan[];
  paypal?: { clientId: string; mode: 'sandbox' | 'live' };
};

type BankTransferDetails = {
  accountName: string;
  accountType: string;
  routingNumber: string;
  accountNumber: string;
  address: string;
  swiftBic: string;
};

type BankTransferRequest = {
  id: string;
  plan: PlanId;
  amount: number;
  currency: 'USD';
  months: number;
  days: number;
  reference: string;
  status: 'instructions' | 'pending' | 'confirmed' | 'rejected';
  senderReference?: string;
  paidUntil?: string;
};

type BankTransferStart = {
  request: BankTransferRequest;
  details: BankTransferDetails;
  previewOnly?: boolean;
};

type Order = {
  provider?: 'razorpay';
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  name: string;
};

type PayPalOrder = { provider: 'paypal'; order_id: string };

type AlreadyPaid = { already_paid: true; paidUntil?: string };

type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayFailure = {
  error?: {
    code?: string;
    description?: string;
    reason?: string;
    source?: string;
    step?: string;
    metadata?: { payment_id?: string; order_id?: string };
  };
};

type RazorpayCheckout = {
  open(): void;
  on(
    event: 'payment.failed',
    handler: (response: RazorpayFailure) => void,
  ): void;
};

/**
 * Tells the server what happened in the checkout window (it can't see it):
 * opened, closed, declined. Only for the order's log; never blocks the page.
 */
function reportCheckout(
  orderId: string,
  event: 'opened' | 'dismissed' | 'failed' | 'error' | 'pending',
  detail: Record<string, string | undefined> = {},
) {
  const clean = Object.fromEntries(
    Object.entries(detail)
      .filter(([, value]) => typeof value === 'string' && value)
      .map(([key, value]) => [key, (value as string).slice(0, 280)]),
  );
  void send('/billing/checkout-event', 'POST', {
    order_id: orderId,
    event,
    ...clean,
  }).catch(() => {});
}

type PayPalButtons = {
  render(container: HTMLElement): Promise<void>;
  close(): Promise<void>;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
    paypal?: {
      Buttons(options: Record<string, unknown>): PayPalButtons;
    };
  }
}

let paypalScript: { clientId: string; ready: Promise<void> } | undefined;

/** Loads PayPal's buttons, in dollars, only when the dialog offers PayPal. */
function loadPayPal(clientId: string) {
  if (paypalScript?.clientId === clientId) return paypalScript.ready;
  const ready = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const query = new URLSearchParams({
      'client-id': clientId,
      currency: 'USD',
      intent: 'capture',
      components: 'buttons',
      'enable-funding': 'card',
      'disable-funding': 'paylater',
    });
    script.src = `https://www.paypal.com/sdk/js?${query}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      paypalScript = undefined;
      script.remove();
      // PayPal answers a bad setup (such as an unknown client ID) with an
      // error message; read it so the dialog can say what went wrong.
      void fetch(script.src)
        .then((response) => (response.ok ? '' : response.text()))
        .catch(() => '')
        .then((body) => {
          const reason = /SDK Validation error: '([^']{1,200})/.exec(body)?.[1];
          reject(
            new Error(
              reason
                ? `PayPal refused to load: ${reason.trim()}`
                : 'PayPal couldn’t load. Check your connection or any ad blocker, then try again.',
            ),
          );
        });
    };
    document.head.appendChild(script);
  });
  paypalScript = { clientId, ready };
  return ready;
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
  | { step: 'pending' }
  | { step: 'done'; until: string };

export default function UpgradeDialog({
  reason,
  plan: initialPlan = 'yearly',
  onClose,
}: {
  /** What the person just tried that needs Premium, if anything. */
  reason: string;
  /** The plan chosen when the dialog opens. */
  plan?: PlanId;
  onClose: () => void;
}) {
  const { user, setUser } = useAuth();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [chosen, setChosen] = useState<PlanId>(initialPlan);
  const [available, setAvailable] = useState(true);
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [bankTransfer, setBankTransfer] = useState<BankTransferStart | null>(
    null,
  );
  const [bankTransferBusy, setBankTransferBusy] = useState(false);
  const [senderReference, setSenderReference] = useState('');
  const state = planState(user);
  const plans = billing?.plans ?? null;
  const currency = billing?.currency ?? 'USD';
  const pass = plans?.find((item) => item.id === chosen) ?? null;
  const transferPlan = bankTransfer
    ? plans?.find((item) => item.id === bankTransfer.request.plan)
    : undefined;
  const money = (amount: number) => formatMoney(amount, currency);
  const paypal = billing?.provider === 'paypal' ? billing.paypal : undefined;

  async function showBankTransfer() {
    if (!user || user.guest || !billing?.bankTransferAvailable) return;
    setBankTransferBusy(true);
    setPhase({ step: 'idle' });
    try {
      const result = await send<BankTransferStart>(
        '/billing/bank-transfer',
        'POST',
        { plan: chosen },
      );
      setBankTransfer(result);
      setSenderReference(result.request.senderReference ?? '');
      setChosen(result.request.plan);
    } catch (error) {
      setPhase({
        step: 'idle',
        tone: 'error',
        message: (error as Error).message,
      });
    } finally {
      setBankTransferBusy(false);
    }
  }

  async function reportBankTransfer() {
    if (!bankTransfer) return;
    setBankTransferBusy(true);
    try {
      const result = await send<{ request: BankTransferRequest }>(
        `/billing/bank-transfer/${encodeURIComponent(bankTransfer.request.id)}/submit`,
        'POST',
        { senderReference: senderReference.trim() || undefined },
      );
      setBankTransfer((current) =>
        current ? { ...current, request: result.request } : current,
      );
      if (result.request.status === 'confirmed')
        await finish(result.request.paidUntil);
      else if (result.request.status === 'rejected')
        setPhase({
          step: 'idle',
          tone: 'error',
          message:
            'This transfer request was declined. Contact us if you think this is a mistake.',
        });
    } catch (error) {
      setPhase({
        step: 'idle',
        tone: 'error',
        message: (error as Error).message,
      });
    } finally {
      setBankTransferBusy(false);
    }
  }

  useEffect(() => {
    api<Billing>('/billing/plan')
      .then((result) => {
        setBilling(result);
        setAvailable(result.available);
      })
      .catch(() => setAvailable(false));
  }, []);

  /** Shows Premium as active once a payment went through. */
  const finish = useCallback(
    async (paidUntil: string | undefined) => {
      const me = await api<{ user: User | null }>('/auth/me');
      setUser(me.user);
      setPhase({
        step: 'done',
        until: paidUntil ?? me.user?.plan?.paidUntil ?? '',
      });
    },
    [setUser],
  );

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
        send<Order | AlreadyPaid>('/billing/create-order', 'POST', {
          plan: chosen,
        }),
        loadCheckout(),
      ]);
      // An earlier payment that never reported back was found and applied.
      if ('already_paid' in order) {
        await finish(order.paidUntil);
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
          ondismiss: () => {
            reportCheckout(order.order_id, 'dismissed');
            setPhase((current) =>
              current.step === 'paying'
                ? {
                    step: 'idle',
                    tone: 'info',
                    message: 'Payment cancelled. You haven’t been charged.',
                  }
                : current,
            );
          },
        },
      });
      checkout.on('payment.failed', (response) => {
        const failure = response.error;
        reportCheckout(order.order_id, 'failed', {
          code: failure?.code,
          reason: failure?.description ?? failure?.reason,
          step: failure?.step,
          source: failure?.source,
          payment_id: failure?.metadata?.payment_id,
        });
        setPhase({
          step: 'idle',
          tone: 'error',
          message: `Payment failed: ${failure?.description ?? 'please try again or use another method.'}`,
        });
      });
      checkout.open();
      reportCheckout(order.order_id, 'opened');
    } catch (error) {
      setPhase({
        step: 'idle',
        tone: 'error',
        message: (error as Error).message,
      });
    }
  }

  if (phase.step === 'pending')
    return (
      <Modal onClose={onClose} className="upgrade-modal">
        <p className="kicker">Payment received</p>
        <h2>Almost there</h2>
        <p className="modal-copy">
          PayPal is reviewing your payment, which usually takes a few minutes.
          Premium switches on by itself as soon as it clears, and we’ll email
          you a receipt. You don’t need to pay again.
        </p>
        <div className="modal-actions">
          <button className="button primary" onClick={onClose}>
            Back to work
          </button>
        </div>
      </Modal>
    );

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
          ? 'Add more Premium time'
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
            ? 'The time you buy starts after your current Premium ends, so you don’t lose a day.'
            : 'Your boards stay yours either way. The free plan keeps your first board for you to use on your own.'}
      </p>
      {plans && (
        <div
          className="upgrade-plans"
          role="radiogroup"
          aria-label="Choose how long"
        >
          {plans.map((item) => {
            const bonus = planBonus(item);
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={item.id === chosen}
                className={`upgrade-plan ${item.id === chosen ? 'is-chosen' : ''}`}
                disabled={busy || bankTransferBusy || Boolean(bankTransfer)}
                onClick={() => setChosen(item.id)}
              >
                <span className="upgrade-plan-length">
                  {planLength(item)}
                  {item.bestValue && (
                    <span className="upgrade-plan-best">Best value</span>
                  )}
                </span>
                <span className="upgrade-plan-price">
                  {item.compareAt > item.amount && (
                    <s aria-label={`Was ${money(item.compareAt)}`}>
                      {money(item.compareAt)}
                    </s>
                  )}
                  <strong>{money(item.amount)}</strong>
                </span>
                <span className="upgrade-plan-tags">
                  {item.savePercent > 0 && (
                    <span className="upgrade-save">
                      Save {item.savePercent}%
                    </span>
                  )}
                  {bonus && <span className="upgrade-bonus">{bonus}</span>}
                </span>
                <small>{formatRate(item.perMonth, currency)} a month</small>
              </button>
            );
          })}
        </div>
      )}
      {pass && (
        <p className="upgrade-fine">
          {currency === 'INR'
            ? 'Paid once in rupees, by UPI, card or netbanking'
            : paypal
              ? 'Paid once in US dollars, with PayPal or a card'
              : 'Paid once in US dollars'}
          , with no automatic renewal. We’ll email you a few days before Premium
          ends.
        </p>
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
      {bankTransfer?.request.status === 'pending' ? (
        <div className="modal-actions">
          <button className="button primary" onClick={onClose}>
            Back to work
          </button>
        </div>
      ) : paypal && pass && user && !user.guest && available ? (
        <p className="upgrade-paypal-label">
          {phase.step === 'verifying'
            ? 'Confirming payment…'
            : `Pay ${money(pass.amount)} for ${planLength(pass)}`}
        </p>
      ) : billing?.provider === 'razorpay' || !billing ? (
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
                    ? `Pay ${money(pass.amount)} for ${planLength(pass)}`
                    : 'Loading…'}
          </button>
        </div>
      ) : billing.bankTransferAvailable ? (
        <div className="modal-actions">
          <button className="button ghost" onClick={onClose}>
            Not now
          </button>
        </div>
      ) : (
        <div className="modal-actions">
          <button className="button ghost" onClick={onClose}>
            Not now
          </button>
          <button className="button primary" disabled>
            Payments unavailable
          </button>
        </div>
      )}
      {billing?.bankTransferAvailable && (
        <section className="upgrade-bank-transfer">
          {!bankTransfer ? (
            <button
              type="button"
              className="button ghost wide"
              disabled={
                busy || bankTransferBusy || !user || user.guest || !pass
              }
              onClick={() => void showBankTransfer()}
            >
              {bankTransferBusy
                ? 'Loading bank details…'
                : 'Pay by bank transfer'}
            </button>
          ) : (
            <>
              <h3>USD bank transfer</h3>
              {bankTransfer.previewOnly && (
                <p className="upgrade-bank-status" role="status">
                  Preview only. Do not send money; this transfer will not be
                  recorded or reviewed.
                </p>
              )}
              <p>
                Send <strong>{money(bankTransfer.request.amount)}</strong> for{' '}
                {transferPlan
                  ? planLength(transferPlan)
                  : `${bankTransfer.request.months} months`}
                . Use the reference below so we can match your transfer.
              </p>
              <dl className="upgrade-bank-details">
                <div>
                  <dt>Recipient</dt>
                  <dd>{bankTransfer.details.accountName}</dd>
                </div>
                <div>
                  <dt>Account type</dt>
                  <dd>{bankTransfer.details.accountType}</dd>
                </div>
                <div>
                  <dt>Routing number (ACH and wire)</dt>
                  <dd>
                    <code>{bankTransfer.details.routingNumber}</code>
                  </dd>
                </div>
                <div>
                  <dt>Account number</dt>
                  <dd>
                    <code>{bankTransfer.details.accountNumber}</code>
                  </dd>
                </div>
                <div>
                  <dt>Bank address</dt>
                  <dd>{bankTransfer.details.address}</dd>
                </div>
                <div>
                  <dt>SWIFT/BIC (senders outside the U.S.)</dt>
                  <dd>
                    <code>{bankTransfer.details.swiftBic}</code>
                  </dd>
                </div>
                <div className="upgrade-bank-reference">
                  <dt>Transfer reference</dt>
                  <dd>
                    <code>{bankTransfer.request.reference}</code>
                  </dd>
                </div>
              </dl>
              <p className="upgrade-bank-note">
                U.S. senders can use ACH or a domestic wire. Senders outside the
                U.S. must send USD by SWIFT. Transfer and intermediary fees may
                apply. After paying, email a screenshot of your payment
                confirmation to{' '}
                <a href="mailto:canvacollabroom@gmail.com">
                  canvacollabroom@gmail.com
                </a>{' '}
                so we can verify it faster. We aim to grant Premium access
                within 3–6 hours of your payment. Access starts after we verify
                the funds.
              </p>
              {bankTransfer.previewOnly ? null : bankTransfer.request.status ===
                'instructions' ? (
                <div className="upgrade-bank-submit">
                  <label>
                    Sender’s bank reference <span>(optional)</span>
                    <input
                      value={senderReference}
                      maxLength={120}
                      onChange={(event) =>
                        setSenderReference(event.target.value)
                      }
                      placeholder="Reference from your transfer receipt"
                    />
                  </label>
                  <button
                    type="button"
                    className="button primary wide"
                    disabled={bankTransferBusy}
                    onClick={() => void reportBankTransfer()}
                  >
                    {bankTransferBusy
                      ? 'Submitting…'
                      : 'I’ve sent the transfer'}
                  </button>
                </div>
              ) : bankTransfer.request.status === 'pending' ? (
                <p className="upgrade-bank-status" role="status">
                  Transfer reported. Premium will activate after we confirm the
                  funds. You don’t need to pay again.
                </p>
              ) : bankTransfer.request.status === 'confirmed' ? (
                <p className="upgrade-bank-status" role="status">
                  Transfer confirmed. Premium is active.
                </p>
              ) : (
                <p className="upgrade-bank-status" role="status">
                  This transfer request was declined. Contact us if you need
                  help.
                </p>
              )}
              {bankTransfer.request.status === 'instructions' && (
                <button
                  type="button"
                  className="upgrade-bank-change"
                  onClick={() => setBankTransfer(null)}
                >
                  Choose a different plan
                </button>
              )}
            </>
          )}
        </section>
      )}
      {paypal &&
        pass &&
        user &&
        !user.guest &&
        available &&
        bankTransfer?.request.status !== 'pending' && (
          <>
            <PayPalCheckout
              clientId={paypal.clientId}
              plan={chosen}
              disabled={busy}
              onPaying={() => setPhase({ step: 'verifying' })}
              onPaid={(paidUntil) => void finish(paidUntil)}
              onPending={() => setPhase({ step: 'pending' })}
              onStop={(message, tone) =>
                setPhase({ step: 'idle', message, tone })
              }
            />
            <div className="modal-actions">
              <button className="button ghost" onClick={onClose}>
                Not now
              </button>
            </div>
          </>
        )}
    </Modal>
  );
}

/**
 * PayPal's own buttons (PayPal, and a card where PayPal offers it). The
 * server creates the order for the chosen plan and captures it once the buyer
 * approves, so the amount never comes from the browser.
 */
function PayPalCheckout({
  clientId,
  plan,
  disabled,
  onPaying,
  onPaid,
  onPending,
  onStop,
}: {
  clientId: string;
  plan: PlanId;
  disabled: boolean;
  onPaying: () => void;
  onPaid: (paidUntil: string | undefined) => void;
  onPending: () => void;
  onStop: (message: string, tone: 'error' | 'info') => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  // The buttons render once; they read the latest plan and handlers from here.
  const latest = useRef({ plan, onPaying, onPaid, onPending, onStop });
  useEffect(() => {
    latest.current = { plan, onPaying, onPaid, onPending, onStop };
  });
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let buttons: PayPalButtons | undefined;
    let cancelled = false;
    // Set when the server found an earlier payment, so PayPal's window
    // closing with an error isn't reported as one.
    let settled = false;
    // The order the buttons are working on, for reporting what happens to it.
    let orderId = '';
    loadPayPal(clientId)
      .then(() => {
        if (cancelled || !container.current || !window.paypal) return;
        buttons = window.paypal.Buttons({
          style: {
            layout: 'vertical',
            shape: 'pill',
            label: 'pay',
            height: 44,
          },
          createOrder: async () => {
            settled = false;
            const order = await send<PayPalOrder | AlreadyPaid>(
              '/billing/create-order',
              'POST',
              { plan: latest.current.plan },
            );
            if ('already_paid' in order) {
              settled = true;
              latest.current.onPaid(order.paidUntil);
              throw new Error('Already paid');
            }
            orderId = order.order_id;
            reportCheckout(order.order_id, 'opened');
            return order.order_id;
          },
          onApprove: async (
            data: { orderID: string },
            actions: { restart(): Promise<void> },
          ) => {
            latest.current.onPaying();
            try {
              const result = await send<{
                paidUntil?: string;
                pending?: boolean;
              }>('/billing/paypal/capture', 'POST', { order_id: data.orderID });
              if (result.pending) latest.current.onPending();
              else latest.current.onPaid(result.paidUntil);
            } catch (error) {
              // PayPal can offer another way to pay on the same order.
              if (
                error instanceof ApiError &&
                error.code === 'instrument_declined'
              )
                return actions.restart();
              latest.current.onStop(
                `${(error as Error).message} If money left your account, contact us with PayPal order ${data.orderID}.`,
                'error',
              );
            }
          },
          onCancel: (data?: { orderID?: string }) => {
            const cancelled = data?.orderID ?? orderId;
            if (cancelled) reportCheckout(cancelled, 'dismissed');
            latest.current.onStop(
              'Payment cancelled. You haven’t been charged.',
              'info',
            );
          },
          onError: (error: unknown) => {
            if (settled) return;
            if (orderId)
              reportCheckout(orderId, 'error', {
                reason: error instanceof Error ? error.message : String(error),
                source: 'paypal-buttons',
              });
            latest.current.onStop(
              error instanceof ApiError
                ? error.message
                : 'PayPal ran into a problem. You haven’t been charged; please try again.',
              'error',
            );
          },
        });
        return buttons.render(container.current);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed((error as Error).message);
      });
    return () => {
      cancelled = true;
      void buttons?.close().catch(() => {});
    };
  }, [clientId]);

  if (failed)
    return (
      <p className="notice error" role="alert">
        {failed}
      </p>
    );
  return (
    <div
      ref={container}
      className="upgrade-paypal"
      aria-busy={disabled}
      style={disabled ? { pointerEvents: 'none', opacity: 0.6 } : undefined}
    />
  );
}

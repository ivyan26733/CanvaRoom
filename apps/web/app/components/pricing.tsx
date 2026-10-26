import {
  formatMoney,
  formatRate,
  planBonus,
  planLength,
  PLANS_BY_CURRENCY,
  type Currency,
} from '../lib/pricing';
import { PlanButton, PricingCta } from './plan-cta';
import { Icon, type IconName } from './icons';
import './pricing.css';

type Cell = boolean | string;

/** What each plan allows, row by row: free trial, free plan, Premium. */
const ROWS: { label: string; cells: [Cell, Cell, Cell] }[] = [
  { label: 'Boards', cells: ['2', '1', 'Unlimited'] },
  {
    label: 'People on a board',
    cells: ['You + 2', 'Just you', 'Unlimited'],
  },
  { label: 'Live drawing, voice and chat', cells: [true, true, true] },
  { label: 'Pages, templates, zoom, history', cells: [true, true, true] },
  {
    label: 'Teaching library: formulas, periodic table, diagrams',
    cells: [true, true, true],
  },
  { label: 'Follow-the-writer', cells: [true, false, true] },
  { label: 'Export to PNG, SVG and PDF', cells: [false, false, true] },
  { label: 'Images on the board', cells: [false, false, true] },
  { label: 'Session recording, up to 4K', cells: [false, false, true] },
];

const PERKS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'grid',
    title: 'A board for every class',
    body: 'Unlimited boards: one per subject, per batch, per sprint. Nothing gets archived to make room.',
  },
  {
    icon: 'users',
    title: 'The whole class in the room',
    body: 'No cap on people. Follow-the-writer pulls every screen to where you are writing, and voice keeps everyone on the same line.',
  },
  {
    icon: 'record',
    title: 'Record the lesson as you teach',
    body: 'Board and voice in one video, in HD up to 4K, saved straight to your computer for students who missed it.',
  },
  {
    icon: 'download',
    title: 'Hand out the notes',
    body: 'Export any page as a PDF for tonight’s homework, a PNG for the group chat, or a crisp SVG for slides.',
  },
  {
    icon: 'image',
    title: 'Write over real material',
    body: 'Drop in diagrams, screenshots, and worksheets, then annotate them live with everyone watching.',
  },
];

const PLANS = [
  { name: 'Free trial', note: '30 minutes of use' },
  { name: 'Free', note: 'After the trial' },
  { name: 'Premium', note: '3, 6 or 12 months' },
];

function Mark({ value }: { value: Cell }) {
  if (typeof value === 'string') return <span>{value}</span>;
  return value ? (
    <Icon name="check" size={18} />
  ) : (
    <span className="pr-no" aria-label="Not included">
      —
    </span>
  );
}

/** Plans and Premium perks, in rupees in India and US dollars elsewhere. */
export function Pricing({ currency }: { currency: Currency }) {
  const premiumPlans = PLANS_BY_CURRENCY[currency];
  // The lowest monthly rate, for "from $5.77 / month".
  const fromRate = Math.min(...premiumPlans.map((plan) => plan.perMonth));
  const money = (amount: number) => formatMoney(amount, currency);
  return (
    <section className="pr" id="pricing" aria-labelledby="pricing-heading">
      <div className="pr-head">
        <p className="st-eyebrow">Plans</p>
        <h2 id="pricing-heading">
          Start free. Go <span>Premium</span> when the class grows.
        </h2>
        <p className="pr-lede">
          Every account starts with a free trial of 30 minutes of active use;
          the clock pauses whenever CanvaRoom isn’t open in front of you. After
          it, the free plan keeps your first board for you to use on your own.
          Premium opens everything up: pay once for 3, 6 or 12 months, and the
          longer plans come with free time on top.
        </p>
      </div>

      <div
        className="pr-table"
        role="table"
        aria-label="What each plan includes"
      >
        <div className="pr-row pr-plans" role="row">
          <span className="pr-label" role="columnheader">
            <span className="visually-hidden">Feature</span>
          </span>
          {PLANS.map((plan, index) => (
            <span
              key={plan.name}
              role="columnheader"
              className={`pr-cell ${index === 2 ? 'is-premium' : ''}`}
            >
              <strong>{plan.name}</strong>
              <small>
                {index === 2 ? (
                  <>
                    From {formatRate(fromRate, currency)} <span>/ month</span>
                  </>
                ) : (
                  plan.note
                )}
              </small>
            </span>
          ))}
        </div>
        {ROWS.map((row) => (
          <div className="pr-row" role="row" key={row.label}>
            <span className="pr-label" role="rowheader">
              {row.label}
            </span>
            {row.cells.map((cell, index) => (
              <span
                key={index}
                role="cell"
                className={`pr-cell ${index === 2 ? 'is-premium' : ''}`}
                data-plan={PLANS[index]!.name}
              >
                <Mark value={cell} />
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className="pr-plan-cards" id="premium-plans">
        {premiumPlans.map((plan) => {
          const bonus = planBonus(plan);
          return (
            <article
              key={plan.id}
              className={`pr-plan ${plan.bestValue ? 'is-best' : ''}`}
              aria-label={`Premium for ${planLength(plan)}`}
            >
              {plan.bestValue && (
                <span className="pr-plan-badge">Best value</span>
              )}
              <h3>{planLength(plan)}</h3>
              <p className="pr-plan-price">
                {plan.compareAt > plan.amount && (
                  <s aria-label={`Was ${money(plan.compareAt)}`}>
                    {money(plan.compareAt)}
                  </s>
                )}
                <strong>{money(plan.amount)}</strong>
              </p>
              <p className="pr-plan-tags">
                {plan.savePercent > 0 && (
                  <span className="pr-save">Save {plan.savePercent}%</span>
                )}
                {bonus && <span className="pr-bonus">{bonus}</span>}
                {!plan.savePercent && !bonus && (
                  <span className="pr-plain">Pay once</span>
                )}
              </p>
              <p className="pr-plan-rate">
                {formatRate(plan.perMonth, currency)} a month
                {bonus ? ', counting the free time' : ''}
              </p>
              <PlanButton
                plan={plan.id}
                label={planLength(plan)}
                primary={plan.bestValue}
              />
            </article>
          );
        })}
      </div>

      <div className="pr-premium">
        <aside className="pr-card" aria-label="About Premium">
          <p className="st-eyebrow">CanvaRoom Premium</p>
          <p className="pr-card-title">Every plan unlocks everything.</p>
          <p className="pr-fine">
            {currency === 'INR'
              ? 'Billed once in rupees: pay by UPI, card or netbanking. '
              : 'Billed once in US dollars: pay with PayPal or a card. '}
            Nothing renews on its own: we’ll email you a few days before Premium
            ends. Paying again adds the new time after your current end date.
          </p>
          <PricingCta />
        </aside>
        <ol className="pr-perks">
          {PERKS.map((perk, index) => (
            <li key={perk.title}>
              <span className="pr-perk-index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <Icon name={perk.icon} size={22} />
              <div>
                <h3>{perk.title}</h3>
                <p>{perk.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

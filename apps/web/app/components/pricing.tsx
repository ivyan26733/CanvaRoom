import { formatMoney, PRICE } from '../lib/pricing';
import { PricingCta } from './plan-cta';
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
  { name: 'Premium', note: 'Per month' },
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

/** Plans and Premium perks, priced in US dollars. */
export function Pricing() {
  const price = PRICE;
  const premium = formatMoney(price.amount);
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
          Premium opens everything up, billed monthly.
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
                    {premium} <span>/ month</span>
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

      <div className="pr-premium">
        <aside className="pr-card" aria-label="Premium price">
          <p className="st-eyebrow">CanvaRoom Premium</p>
          <p className="pr-price">
            {price.listAmount > price.amount && (
              <s aria-label={`Was ${formatMoney(price.listAmount)}`}>
                {formatMoney(price.listAmount)}
              </s>
            )}
            <strong>{premium}</strong>
            <span>/ month</span>
          </p>
          {price.listAmount > price.amount && (
            <p className="pr-offer">Launch offer</p>
          )}
          <p className="pr-fine">
            Billed in US dollars. Each payment unlocks a month; nothing renews
            on its own.
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

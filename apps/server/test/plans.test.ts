// The 3, 6 and 12-month plans: prices, savings, bonus time, and calendar
// arithmetic. The web app's copy of the table must say the same thing.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const plans = await import('../src/plans.js');
const web = await import('../../web/app/lib/pricing.js');

describe('plans', () => {
  test('charge $20, $35 and $65 for 3, 6 and 12 months', () => {
    assert.deepEqual(
      plans.PLANS.map(({ id, amount, months }) => ({ id, amount, months })),
      [
        { id: 'quarterly', amount: 2000, months: 3 },
        { id: 'half-year', amount: 3500, months: 6 },
        { id: 'yearly', amount: 6500, months: 12 },
      ],
    );
    assert.ok(plans.PLANS.every((plan) => plan.currency === 'USD'));
  });

  test('show the saving against the 3-month rate', () => {
    const [quarterly, halfYear, yearly] = plans.PLANS;
    assert.equal(quarterly!.savePercent, 0);
    assert.equal(halfYear!.compareAt, 4000);
    assert.equal(halfYear!.savePercent, 12);
    assert.equal(yearly!.compareAt, 8000);
    assert.equal(yearly!.savePercent, 19);
    assert.ok(yearly!.bestValue && !halfYear!.bestValue);
  });

  test('add 15 days to 6 months and a month to 12', () => {
    assert.deepEqual(plans.termOfPlan(plans.planById('quarterly')!), {
      months: 3,
      days: 0,
    });
    assert.deepEqual(plans.termOfPlan(plans.planById('half-year')!), {
      months: 6,
      days: 15,
    });
    assert.deepEqual(plans.termOfPlan(plans.planById('yearly')!), {
      months: 13,
      days: 0,
    });
    assert.equal(
      plans.termLabel(plans.planById('half-year')!),
      '6 months + 15 days free',
    );
    assert.equal(
      plans.termLabel(plans.planById('yearly')!),
      '12 months + 1 month free',
    );
  });

  test('cost $6.67, $5.38 and $5.00 a month with the bonus', () => {
    assert.deepEqual(
      plans.PLANS.map((plan) => plan.perMonth),
      [667, 538, 500],
    );
  });

  test('count calendar months, clamping to shorter months', () => {
    const now = Date.parse('2027-01-31T10:00:00.000Z');
    assert.equal(
      plans.extendBy(undefined, { months: 1, days: 0 }, now),
      '2027-02-28T10:00:00.000Z',
    );
    assert.equal(
      plans.extendBy(undefined, { months: 6, days: 15 }, now),
      '2027-08-15T10:00:00.000Z',
    );
    // From the current end when that is later than now.
    assert.equal(
      plans.extendBy('2027-03-15T00:00:00.000Z', { months: 3, days: 0 }, now),
      '2027-06-15T00:00:00.000Z',
    );
  });

  test('read old one-month orders as the legacy days', () => {
    const before = new Date(plans.PLANS_SINCE - 1).toISOString();
    const after = new Date(plans.PLANS_SINCE + 1).toISOString();
    assert.deepEqual(
      plans.termOfOrder({ amount: 2000, createdAt: before }, 30),
      { months: 0, days: 30 },
    );
    assert.deepEqual(
      plans.termOfOrder({ amount: 2000, createdAt: after }, 30),
      { months: 3, days: 0 },
    );
    assert.deepEqual(
      plans.termOfOrder({ amount: 6500, createdAt: after }, 30),
      { months: 13, days: 0 },
    );
    // A recorded plan wins over the amount.
    assert.deepEqual(
      plans.termOfOrder(
        {
          plan: 'yearly',
          months: 13,
          days: 0,
          amount: 6500,
          createdAt: before,
        },
        30,
      ),
      { months: 13, days: 0 },
    );
  });

  for (const currency of plans.CURRENCIES)
    test(`match what the web app shows, in ${currency}`, () => {
      // The web app's table has every field but the receipt name.
      const fields = Object.keys(
        web.PLANS[0]!,
      ) as (keyof (typeof web.PLANS)[0])[];
      assert.deepEqual(
        plans
          .plansFor(currency)
          .map((plan) =>
            Object.fromEntries(fields.map((field) => [field, plan[field]])),
          ),
        web.PLANS_BY_CURRENCY[currency],
      );
      assert.equal(
        web.currencyForCountry('IN'),
        plans.currencyForCountry('IN'),
      );
      assert.equal(
        web.currencyForCountry('NO'),
        plans.currencyForCountry('NO'),
      );
    });
});

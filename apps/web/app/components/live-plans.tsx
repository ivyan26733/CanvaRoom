'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  formatMoney,
  formatRate,
  planBonus,
  planLength,
  PLANS_BY_CURRENCY,
  type Currency,
  type PremiumPlan,
} from '../lib/pricing';
import { PlanButton } from './plan-cta';

let live: Promise<Record<Currency, PremiumPlan[]> | null> | undefined;

/**
 * The plans as the server charges them now. The page renders with the prices
 * in code, then swaps in the server's, which an admin may have changed.
 */
function useLivePlans(currency: Currency) {
  const [plans, setPlans] = useState<readonly PremiumPlan[]>(
    PLANS_BY_CURRENCY[currency],
  );
  useEffect(() => {
    let alive = true;
    live ??= api<{ plans: Record<Currency, PremiumPlan[]> }>('/billing/prices')
      .then((result) => result.plans)
      .catch(() => null);
    void live.then((result) => {
      if (alive && result?.[currency]?.length === 3) setPlans(result[currency]);
    });
    return () => {
      alive = false;
    };
  }, [currency]);
  return plans;
}

/** "From $5.77 / month": the lowest monthly rate. */
export function FromRate({ currency }: { currency: Currency }) {
  const plans = useLivePlans(currency);
  const fromRate = Math.min(...plans.map((plan) => plan.perMonth));
  return (
    <>
      From {formatRate(fromRate, currency)} <span>/ month</span>
    </>
  );
}

/** The 3, 6 and 12-month cards, each with its price and saving. */
export function PlanCards({ currency }: { currency: Currency }) {
  const plans = useLivePlans(currency);
  const money = (amount: number) => formatMoney(amount, currency);
  return (
    <div className="pr-plan-cards" id="premium-plans">
      {plans.map((plan) => {
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
  );
}

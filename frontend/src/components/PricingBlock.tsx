import { useState } from "react";
import { billing as billingApi, ApiError, type PlanKey, type Tier } from "../lib/api";
import "./PricingBlock.css";

/**
 * Reusable pricing block (V2) — 3 cards (Free Trial / Starter / Pro) with a
 * monthly/annual toggle that shows the savings. Used on the public landing
 * and the /billing page.
 *
 * On the landing (not signed in), the CTAs link to /sign-in.
 * On /billing (signed in), the CTAs start a Stripe Checkout for the chosen
 * plan (or show "Current plan" on the active tier).
 */

interface Plan {
  key: Tier | "starter" | "pro";
  name: string;
  monthly: number;
  annual: number; // per-year
  projects: string;
  blurb: string;
  features: string[];
  cta: string;
  planKey?: PlanKey; // the Stripe plan key for checkout (undefined for trial)
  highlight?: boolean;
}

const PLANS: Plan[] = [
  {
    key: "trial",
    name: "Free Trial",
    monthly: 0,
    annual: 0,
    projects: "1 project",
    blurb: "Try the agent free — no card needed.",
    features: ["2 agent turns on us", "1 Genesis project", "Full agent + history", "No card required"],
    cta: "Start free",
  },
  {
    key: "starter",
    name: "Starter",
    monthly: 27,
    annual: 259,
    projects: "2 projects",
    blurb: "For building your own sites.",
    features: ["2 Genesis projects", "Unlimited agent turns (BYO key)", "Full conversation history", "Email support"],
    cta: "Choose Starter",
    planKey: "starter_monthly",
    highlight: true,
  },
  {
    key: "pro",
    name: "Pro",
    monthly: 39,
    annual: 374,
    projects: "Unlimited",
    blurb: "For agencies & power users.",
    features: ["Unlimited Genesis projects", "Unlimited agent turns (BYO key)", "Priority support", "Longer history retention"],
    cta: "Choose Pro",
    planKey: "pro_monthly",
  },
];

interface Props {
  /** Signed-in: the user's current tier (drives "Current plan" labels + checkout CTAs). Null = public landing. */
  currentTier?: Tier | null;
  /** Compact mode for the /billing page (smaller header). */
  compact?: boolean;
}

export function PricingBlock({ currentTier = null, compact = false }: Props) {
  const [annual, setAnnual] = useState(false);
  const [busy, setBusy] = useState<PlanKey | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function startCheckout(plan: Plan) {
    if (!plan.planKey || !currentTier) return; // public landing → /sign-in handled by CTA
    setBusy(plan.planKey);
    setErr(null);
    try {
      const planKey: PlanKey = annual
        ? (plan.planKey.replace("monthly", "annual") as PlanKey)
        : plan.planKey;
      const { url } = await billingApi.checkout(planKey);
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not start checkout.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pb-wrap">
      {/* monthly/annual toggle */}
      <div className="pb-toggle-row">
        <span className={!annual ? "active" : ""}>Monthly</span>
        <button
          className={`pb-toggle ${annual ? "on" : ""}`}
          onClick={() => setAnnual(!annual)}
          aria-label="Toggle annual billing"
        >
          <span className="pb-knob" />
        </button>
        <span className={annual ? "active" : ""}>
          Annual <span className="pb-save">save 20%</span>
        </span>
      </div>

      {err && <div className="banner banner-err" style={{ maxWidth: 640, margin: "0 auto 16px" }}>{err}</div>}

      <div className={`pb-cards ${compact ? "compact" : ""}`}>
        {PLANS.map((p) => {
          const isCurrent =
            currentTier &&
            ((p.key === "trial" && currentTier === "trial") ||
              (p.key === "starter" && currentTier === "starter") ||
              (p.key === "pro" && (currentTier === "pro")));
          const price = annual ? Math.round(p.annual / 12) : p.monthly;
          const period = p.monthly === 0 ? "" : annual ? "/mo" : "/mo";
          const billedNote = annual && p.annual > 0 ? `billed $${p.annual}/yr` : p.monthly === 0 ? "" : "billed monthly";

          return (
            <div key={p.key} className={`pb-card ${p.highlight ? "highlight" : ""} ${isCurrent ? "current" : ""}`}>
              {p.highlight && <div className="pb-badge">Most popular</div>}
              <h3>{p.name}</h3>
              <div className="pb-price">
                {p.monthly === 0 ? (
                  <span className="pb-amount">Free</span>
                ) : (
                  <>
                    <span className="pb-amount">${price}</span>
                    <span className="pb-period">{period}</span>
                  </>
                )}
              </div>
              {billedNote && <div className="pb-billed">{billedNote}</div>}
              <p className="pb-blurb">{p.blurb}</p>
              <div className="pb-projects">{p.projects}</div>
              <ul className="pb-features">
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {isCurrent ? (
                <button className="btn btn-ghost pb-cta" disabled>Current plan</button>
              ) : currentTier ? (
                <button
                  className={`btn ${p.highlight ? "btn-primary" : "btn-ghost"} pb-cta`}
                  onClick={() => p.planKey && startCheckout(p)}
                  disabled={!!busy || !p.planKey}
                >
                  {busy === p.planKey ? "Redirecting…" : p.cta}
                </button>
              ) : (
                <a className={`btn ${p.highlight ? "btn-primary" : "btn-ghost"} pb-cta`} href="/sign-in">
                  {p.cta}
                </a>
              )}
            </div>
          );
        })}
      </div>
      {!compact && (
        <p className="pb-foot">
          All plans use your own OpenRouter key (you control the AI spend). Upgrade, downgrade, or cancel anytime.
        </p>
      )}
    </div>
  );
}

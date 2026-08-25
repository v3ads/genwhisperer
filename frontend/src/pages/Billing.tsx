import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppNav } from "../components/AppNav";
import { PricingBlock } from "../components/PricingBlock";
import { billing as billingApi, ApiError, type SubscriptionState } from "../lib/api";
import { useAuth } from "../lib/auth";
import "./App.css";

/**
 * /billing page (V2) — current plan + upgrade/downgrade/cancel + the pricing block.
 *
 * Shows the user's current tier + status (trial turns left, plan, lapsed read-only),
 * a "Manage subscription" button (→ Stripe Customer Portal for cancel/card update),
 * and the PricingBlock for upgrading/downgrading (→ Stripe Checkout). The admin
 * account sees an "Admin — unlimited access" banner instead of pricing pressure.
 */
export default function Billing() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [sub, setSub] = useState<SubscriptionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  async function load() {
    try {
      const s = await billingApi.subscription();
      setSub(s);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load subscription.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  // Surface the success/canceled query params from Stripe Checkout redirects.
  useEffect(() => {
    if (params.get("success") === "1") {
      setOk("Subscription updated! Your plan is now active.");
    } else if (params.get("canceled") === "1") {
      setErr("Checkout was canceled. Your plan is unchanged.");
    }
  }, [params]);

  async function openPortal() {
    setPortalBusy(true);
    setErr(null);
    try {
      const { url } = await billingApi.portal();
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not open the billing portal.");
    } finally { setPortalBusy(false); }
  }

  const isAdmin = user?.role === "admin";

  return (
    <div className="app-wrap">
      <div className="app-glow" />
      <AppNav />
      <main className="app-main" style={{ maxWidth: 920 }}>
        {err && <div className="banner banner-err">{err}</div>}
        {ok && <div className="banner banner-ok">{ok}</div>}

        {/* ─── Current plan card ─── */}
        <div className="card">
          <h2>Current plan</h2>
          {loading ? (
            <p style={{ color: "var(--text-faint)", fontSize: 14 }}>Loading…</p>
          ) : sub ? (
            <>
              <p className="sub" style={{ marginBottom: 18 }}>{sub.statusLabel}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 18 }}>
                <Stat label="Tier" value={tierLabel(sub.tier)} />
                <Stat label="Projects" value={sub.maxProjects === null ? "Unlimited" : `${sub.maxProjects}`} />
                <Stat
                  label="Agent turns"
                  value={
                    sub.freeMode
                      ? sub.usePlatformKey
                        ? `Unlimited · ${sub.trialTurnCap - sub.trialTurnsUsed} intro turn${sub.trialTurnCap - sub.trialTurnsUsed === 1 ? "" : "s"} on our key`
                        : "Unlimited (your key)"
                      : sub.tier === "trial"
                        ? `${sub.trialTurnCap - sub.trialTurnsUsed} of ${sub.trialTurnCap} left`
                        : "Unlimited"
                  }
                />
                <Stat label="Status" value={sub.canStartTurn ? "Active" : sub.needsOwnKey ? "Needs your key" : "Limited"} />
              </div>

              {sub.freeMode && !isAdmin && (
                <div className="banner banner-ok" style={{ marginTop: 0, marginBottom: 18 }}>
                  GenWhisperer is free right now — no subscription needed. Your first{" "}
                  {sub.trialTurnCap} turns run on our OpenRouter key; after that, add your own key
                  in Profile and keep building free. Enjoying it? We'd love a testimonial at{" "}
                  <a href={`mailto:${sub.testimonialEmail}?subject=GenWhisperer%20testimonial`} style={{ color: "var(--cyan)", textDecoration: "underline" }}>
                    {sub.testimonialEmail}
                  </a>
                  .
                </div>
              )}

              {isAdmin ? (
                <div className="banner banner-ok" style={{ margin: 0 }}>
                  Admin account — unlimited access to all features, no billing required.
                </div>
              ) : sub.hasStripeCustomer ? (
                <div className="btn-row">
                  <button className="btn btn-ghost" onClick={openPortal} disabled={portalBusy}>
                    {portalBusy ? "Opening…" : "Manage subscription (cancel / update card)"}
                  </button>
                </div>
              ) : sub.tier === "trial" ? (
                <p style={{ color: "var(--text-dim)", fontSize: 13.5, margin: 0 }}>
                  You're on the free trial. Pick a plan below to keep building after your turns run out.
                </p>
              ) : (
                <p style={{ color: "var(--text-dim)", fontSize: 13.5, margin: 0 }}>
                  Pick a plan below to resume building.
                </p>
              )}
            </>
          ) : (
            <p style={{ color: "var(--text-faint)", fontSize: 14 }}>Could not load your plan.</p>
          )}
        </div>

        {/* ─── Pricing block (upgrade/downgrade) ─── */}
        {!isAdmin && (
          <>
            <h2 style={{ fontSize: 22, margin: "28px 0 6px", textAlign: "center" }}>Choose your plan</h2>
            <p style={{ color: "var(--text-dim)", fontSize: 14, textAlign: "center", margin: "0 0 24px" }}>
              Upgrade, downgrade, or cancel anytime. {sub?.tier === "lapsed" && "Resubscribe to resume building."}
            </p>
            <PricingBlock currentTier={sub?.tier ?? null} compact />
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--navy-1)", border: "1px solid var(--line-soft)", borderRadius: 10, padding: "11px 13px" }}>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, color: "var(--text)", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function tierLabel(t: string): string {
  switch (t) {
    case "trial": return "Free Trial";
    case "starter": return "Starter";
    case "pro": return "Pro";
    case "lapsed": return "Lapsed";
    default: return t;
  }
}

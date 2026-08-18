/**
 * Billing / tier resolution service (Phase 7a).
 *
 * The source of truth for a user's tier is the `subscriptions` table, updated
 * by Stripe webhooks. This module resolves a user → tier + the limits that
 * gate the app (max Genesis projects, trial turn cap, whether they can start
 * new agent turns).
 *
 * Tiers:
 *   trial   — free, 1 project, 2 agent turns on the platform key (cap from
 *             system_settings `trial_turn_cap`, default 2). BYO key optional.
 *   starter — $27/mo or $259/yr, 2 projects, BYO key, full agent + history.
 *   pro     — $39/mo or $374/yr, unlimited projects, BYO key, priority.
 *   lapsed  — paid sub ended/canceled → read-only (keep projects + history,
 *             cannot start new agent turns).
 *
 * Admins bypass all gating (unlimited).
 */

import { eq } from "drizzle-orm";
import { db, subscriptions, users } from "../db/index.js";
import { getSetting } from "./settings.js";

export type Tier = "trial" | "starter" | "pro" | "lapsed";

export interface TierState {
  tier: Tier;
  /** Max Genesis projects allowed (null = unlimited). */
  maxProjects: number | null;
  /** Trial turns used so far (only meaningful for trial tier). */
  trialTurnsUsed: number;
  /** Trial turn cap (only meaningful for trial tier). */
  trialTurnCap: number;
  /** Whether the user can start a new agent turn. */
  canStartTurn: boolean;
  /** Whether the user must use the platform key (trial) or their own (paid). */
  usePlatformKey: boolean;
  /** Human-readable status for the UI. */
  statusLabel: string;
}

const DEFAULT_TRIAL_TURN_CAP = 2;
const TIER_PROJECT_LIMITS: Record<Tier, number | null> = {
  trial: 1,
  starter: 2,
  pro: null, // unlimited
  lapsed: null, // keep existing projects; just can't start turns
};

/**
 * Resolve a user's current tier + limits. Creates a `trial` subscription row
 * if none exists yet (every new user starts on the free trial). Admins get
 * unlimited access regardless of subscription.
 */
export async function getTierState(userId: number): Promise<TierState> {
  // Admins bypass gating.
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const isAdmin = userRows[0]?.role === "admin";

  const subRows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  let sub = subRows[0];

  // Auto-create a trial subscription row for new users.
  if (!sub) {
    const [created] = await db
      .insert(subscriptions)
      .values({ userId, tier: "trial", trialTurnsUsed: 0 })
      .returning();
    sub = created;
  }

  const tier = sub.tier as Tier;
  const trialTurnCap = await getTrialTurnCap();
  const trialTurnsUsed = sub.trialTurnsUsed;

  if (isAdmin) {
    return {
      tier: "pro", // admin treated as pro for limits
      maxProjects: null,
      trialTurnsUsed,
      trialTurnCap,
      canStartTurn: true,
      usePlatformKey: false,
      statusLabel: "Admin (unlimited)",
    };
  }

  const maxProjects = TIER_PROJECT_LIMITS[tier];
  const usePlatformKey = tier === "trial";
  // Trial: can start a turn only if under the cap. Lapsed: cannot start turns.
  // Starter/Pro: unlimited turns (BYO key).
  let canStartTurn: boolean;
  let statusLabel: string;
  if (tier === "trial") {
    canStartTurn = trialTurnsUsed < trialTurnCap;
    statusLabel = canStartTurn
      ? `Free trial — ${trialTurnCap - trialTurnsUsed} turn${trialTurnCap - trialTurnsUsed === 1 ? "" : "s"} left`
      : "Free trial used up — upgrade to keep building";
  } else if (tier === "lapsed") {
    canStartTurn = false;
    statusLabel = "Subscription lapsed — resubscribe to resume building (your projects + history are kept)";
  } else {
    canStartTurn = true;
    statusLabel = tier === "starter" ? "Starter plan" : "Pro plan";
  }

  return { tier, maxProjects, trialTurnsUsed, trialTurnCap, canStartTurn, usePlatformKey, statusLabel };
}

/** Trial turn cap from system_settings (default 2) — tunable without a redeploy. */
export async function getTrialTurnCap(): Promise<number> {
  const val = await getSetting("trial_turn_cap");
  return val ? parseInt(val, 10) : DEFAULT_TRIAL_TURN_CAP;
}

/** Increment the trial turn counter (called after a trial agent turn completes). */
export async function incrementTrialTurns(userId: number): Promise<void> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  if (!rows[0] || rows[0].tier !== "trial") return;
  await db
    .update(subscriptions)
    .set({ trialTurnsUsed: (rows[0].trialTurnsUsed ?? 0) + 1, updatedAt: new Date() })
    .where(eq(subscriptions.userId, userId));
}

/**
 * Check whether the user can add another Genesis project. Throws a typed error
 * the route can map to a 402 if the limit is hit.
 */
export async function canAddProject(userId: number): Promise<{ ok: boolean; maxProjects: number | null; current: number }> {
  const state = await getTierState(userId);
  if (state.maxProjects === null) return { ok: true, maxProjects: null, current: 0 };
  // Count existing projects (imported lazily to avoid a circular import).
  const { genesisProjects } = await import("../db/index.js");
  const rows = await db.select().from(genesisProjects).where(eq(genesisProjects.userId, userId));
  return { ok: rows.length < state.maxProjects, maxProjects: state.maxProjects, current: rows.length };
}

/**
 * Update a user's subscription from a Stripe webhook event. Idempotent.
 * Maps Stripe status → tier: active/active → starter|pro (by price id),
 * canceled/unpaid → lapsed.
 */
export async function applySubscriptionUpdate(opts: {
  userId: number;
  stripeSubscriptionId: string;
  stripePriceId: string;
  status: string;
  currentPeriodEnd: Date | null;
  interval: "month" | "year" | null;
}): Promise<void> {
  const tier = priceIdToTier(opts.stripePriceId);
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, opts.userId)).limit(1);
  if (rows[0]) {
    await db
      .update(subscriptions)
      .set({
        tier,
        stripeSubscriptionId: opts.stripeSubscriptionId,
        stripePriceId: opts.stripePriceId,
        status: opts.status,
        currentPeriodEnd: opts.currentPeriodEnd,
        interval: opts.interval,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, opts.userId));
  } else {
    await db.insert(subscriptions).values({
      userId: opts.userId,
      tier,
      stripeSubscriptionId: opts.stripeSubscriptionId,
      stripePriceId: opts.stripePriceId,
      status: opts.status,
      currentPeriodEnd: opts.currentPeriodEnd,
      interval: opts.interval,
    });
  }
}

/** Mark a user lapsed (subscription canceled/deleted/unpaid). */
export async function markLapsed(userId: number): Promise<void> {
  await db
    .update(subscriptions)
    .set({ tier: "lapsed", status: "canceled", updatedAt: new Date() })
    .where(eq(subscriptions.userId, userId));
}

/** Map a Stripe price id → tier using the env-configured price ids. */
function priceIdToTier(priceId: string): Tier {
  const starterMonthly = process.env.STRIPE_PRICE_STARTER_MONTHLY;
  const starterAnnual = process.env.STRIPE_PRICE_STARTER_ANNUAL;
  const proMonthly = process.env.STRIPE_PRICE_PRO_MONTHLY;
  const proAnnual = process.env.STRIPE_PRICE_PRO_ANNUAL;
  if (priceId === starterMonthly || priceId === starterAnnual) return "starter";
  if (priceId === proMonthly || priceId === proAnnual) return "pro";
  // Unknown price — default to starter (safer than lapsed).
  console.warn(`[billing] unknown Stripe price id ${priceId}, defaulting to starter`);
  return "starter";
}

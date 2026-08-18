/**
 * Stripe integration service (Phase 7a).
 *
 * Wraps the Stripe SDK for the three operations the billing route needs:
 *  - createCheckoutSession: start a subscription (upgrade/downgrade/new)
 *  - createPortalSession: let the user manage their sub (cancel, update card)
 *  - constructWebhookEvent: verify + parse an incoming webhook (raw body + sig)
 *
 * Price ids live in env (STRIPE_PRICE_STARTER_MONTHLY/ANNUAL,
 * STRIPE_PRICE_PRO_MONTHLY/ANNUAL) — the owner creates the products in the
 * Stripe dashboard and pastes the ids into Railway.
 */

import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, stripeCustomers } from "../db/index.js";

let client: Stripe | null = null;

function stripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set. Configure it in Railway env.");
  client = new Stripe(key, { apiVersion: "2024-06-20" as Stripe.LatestApiVersion });
  return client;
}

/** Price ids the frontend references by plan key (resolved here from env). */
export const PRICE_IDS = {
  starter_monthly: () => process.env.STRIPE_PRICE_STARTER_MONTHLY!,
  starter_annual: () => process.env.STRIPE_PRICE_STARTER_ANNUAL!,
  pro_monthly: () => process.env.STRIPE_PRICE_PRO_MONTHLY!,
  pro_annual: () => process.env.STRIPE_PRICE_PRO_ANNUAL!,
} as const;

export type PlanKey = keyof typeof PRICE_IDS;

/** Resolve a plan key → Stripe price id. Throws if the env var is missing. */
export function priceIdForPlan(plan: PlanKey): string {
  const id = PRICE_IDS[plan]();
  if (!id) throw new Error(`Stripe price id for ${plan} is not configured in env.`);
  return id;
}

/**
 * Create a Checkout Session for a new subscription (or upgrade). The user is
 * redirected to Stripe-hosted checkout, then back to APP_URL/billing on success.
 * We pass the userId in client_reference_id so the webhook can link the session
 * to the user. Stripe auto-creates a customer if needed (we reuse it via the
 * customer id on subsequent checkouts).
 */
export async function createCheckoutSession(opts: {
  userId: number;
  email: string;
  plan: PlanKey;
  customerId?: string; // existing Stripe customer id (for upgrades)
}): Promise<{ url: string }> {
  const s = stripe();
  const priceId = priceIdForPlan(opts.plan);
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: opts.customerId ? undefined : opts.email,
    customer: opts.customerId,
    client_reference_id: String(opts.userId),
    success_url: `${process.env.APP_URL ?? "https://www.genwhisperer.com"}/billing?success=1`,
    cancel_url: `${process.env.APP_URL ?? "https://www.genwhisperer.com"}/billing?canceled=1`,
    subscription_data: { metadata: { userId: String(opts.userId) } },
    allow_promotion_codes: true,
  });
  return { url: session.url! };
}

/** Create a Customer Portal session so the user can manage their subscription. */
export async function createPortalSession(opts: {
  customerId: string;
}): Promise<{ url: string }> {
  const s = stripe();
  const session = await s.billingPortal.sessions.create({
    customer: opts.customerId,
    return_url: `${process.env.APP_URL ?? "https://www.genwhisperer.com"}/billing`,
  });
  return { url: session.url };
}

/** Verify + parse a webhook event from the raw request body + signature header. */
export function constructWebhookEvent(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set. Configure it in Railway env.");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}

/** Fetch the Stripe customer id for a user from our stripe_customers table. */
export async function getCustomerId(userId: number): Promise<string | null> {
  const rows = await db.select().from(stripeCustomers).where(eq(stripeCustomers.userId, userId)).limit(1);
  return rows[0]?.stripeCustomerId ?? null;
}

/** Store/refresh the Stripe customer id for a user (upsert). */
export async function upsertCustomerId(userId: number, customerId: string): Promise<void> {
  const existing = await db.select().from(stripeCustomers).where(eq(stripeCustomers.userId, userId)).limit(1);
  if (existing[0]) {
    await db
      .update(stripeCustomers)
      .set({ stripeCustomerId: customerId })
      .where(eq(stripeCustomers.userId, userId));
  } else {
    await db.insert(stripeCustomers).values({ userId, stripeCustomerId: customerId });
  }
}

/** Look up our user id from a Stripe customer id (webhook path). */
export async function getUserIdByCustomerId(customerId: string): Promise<number | null> {
  const rows = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.stripeCustomerId, customerId))
    .limit(1);
  return rows[0]?.userId ?? null;
}

/**
 * Billing routes (Phase 7a).
 *
 *   POST /api/billing/checkout    Start a subscription/upgrade (→ Stripe Checkout URL)
 *   GET  /api/billing/subscription  Current tier + status + trial turns
 *   POST /api/billing/portal      Manage subscription (→ Stripe Portal URL)
 *   POST /api/billing/webhook     Stripe → us (raw body, signature verified)
 *
 * The webhook route is mounted with a raw-body capture (see index.ts) because
 * Stripe signature verification needs the exact raw bytes, not express.json's
 * parsed body.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import {
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
  getCustomerId,
  upsertCustomerId,
  getUserIdByCustomerId,
  type PlanKey,
} from "../services/stripe.js";
import { getTierState, applySubscriptionUpdate, markLapsed } from "../services/billing.js";
import { TESTIMONIAL_EMAIL } from "../services/settings.js";
import { z } from "zod";

const router: ReturnType<typeof Router> = Router();

// ─── POST /api/billing/checkout ───────────────────────────────────────────────
// Start a subscription or upgrade. Body: { plan: "starter_monthly" | "starter_annual" | "pro_monthly" | "pro_annual" }.
router.post("/checkout", requireAuth, async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    plan: z.enum(["starter_monthly", "starter_annual", "pro_monthly", "pro_annual"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }
  try {
    const customerId = await getCustomerId(req.user!.id);
    const { url } = await createCheckoutSession({
      userId: req.user!.id,
      email: req.user!.email,
      plan: parsed.data.plan as PlanKey,
      customerId: customerId ?? undefined,
    });
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ─── GET /api/billing/subscription ────────────────────────────────────────────
// Current tier + status + trial usage (for the /billing page + Builder indicator).
router.get("/subscription", requireAuth, async (req: AuthRequest, res) => {
  const state = await getTierState(req.user!.id);
  const customerId = await getCustomerId(req.user!.id);
  res.json({
    tier: state.tier,
    maxProjects: state.maxProjects,
    trialTurnsUsed: state.trialTurnsUsed,
    trialTurnCap: state.trialTurnCap,
    canStartTurn: state.canStartTurn,
    usePlatformKey: state.usePlatformKey,
    statusLabel: state.statusLabel,
    hasStripeCustomer: !!customerId,
    freeMode: state.freeMode,
    hasOwnKey: state.hasOwnKey,
    needsOwnKey: state.needsOwnKey,
    testimonialEmail: TESTIMONIAL_EMAIL,
  });
});

// ─── POST /api/billing/portal ─────────────────────────────────────────────────
// Open the Stripe Customer Portal (cancel, update card, view invoices).
router.post("/portal", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const customerId = await getCustomerId(req.user!.id);
    if (!customerId) {
      res.status(400).json({ error: "No billing account found. Start a subscription first." });
      return;
    }
    const { url } = await createPortalSession({ customerId });
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ─── POST /api/billing/webhook ────────────────────────────────────────────────
// Stripe → us. Raw body is captured in index.ts (req.rawBody). Verifies the
// signature, then updates the subscriptions table. Always responds 200 so
// Stripe doesn't retry on a processing error (we log instead).
router.post("/webhook", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string | undefined;
  const rawBody = (req as Request & { rawBody?: string }).rawBody;
  if (!sig || !rawBody) {
    res.status(400).send("Missing signature or raw body");
    return;
  }
  let event;
  try {
    event = constructWebhookEvent(rawBody, sig);
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", (err as Error).message);
    res.status(400).send(`Webhook Error: ${(err as Error).message}`);
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const sess = event.data.object as unknown as {
          client_reference_id?: string;
          customer?: string;
          customer_email?: string;
        };
        const userId = sess.client_reference_id ? parseInt(sess.client_reference_id, 10) : null;
        if (userId && sess.customer) {
          await upsertCustomerId(userId, sess.customer as string);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as unknown as {
          customer: string;
          id: string;
          status: string;
          current_period_end: number;
          items?: { data?: Array<{ price?: { id?: string } }> };
        };
        const userId = await getUserIdByCustomerId(sub.customer as string);
        if (userId) {
          const priceId = sub.items?.data?.[0]?.price?.id ?? "";
          await applySubscriptionUpdate({
            userId,
            stripeSubscriptionId: sub.id as string,
            stripePriceId: priceId as string,
            status: sub.status as string,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            interval: null, // resolved from price id in applySubscriptionUpdate via tier
          });
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as unknown as { customer: string };
        const userId = await getUserIdByCustomerId(sub.customer as string);
        if (userId) await markLapsed(userId);
        break;
      }
      default:
        // Unhandled event type — acknowledge but don't act.
        break;
    }
    res.status(200).json({ received: true });
  } catch (err) {
    // Respond 200 so Stripe doesn't retry; log for investigation.
    console.error("[stripe webhook] processing error:", (err as Error).message);
    res.status(200).json({ received: true, error: "processing_failed" });
  }
});

export default router;

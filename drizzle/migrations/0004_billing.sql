-- Migration: 0004_billing
-- Adds Stripe billing tables for the V2 subscription model (Phase 7a):
-- free trial (2 turns on platform key) → Starter $27 or Pro $39, monthly or
-- annual (20% off), upgrade/downgrade anytime (end-of-period), lapsed=read-only.
-- All idempotent (IF NOT EXISTS) so re-running is safe. Matches the 0001/0002/0003 style.
--
-- Tables added:
--   stripe_customers  — one row per user who touched Stripe (stripe_customer_id)
--   subscriptions     — current tier + Stripe subscription state (source of truth for gating)
--
-- Enum added:
--   tier              — trial | starter | pro | lapsed

-- ─── Enum ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tier') THEN
    CREATE TYPE tier AS ENUM ('trial', 'starter', 'pro', 'lapsed');
  END IF;
END
$$;

-- ─── stripe_customers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stripe_customers (
    id                 SERIAL PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    stripe_customer_id VARCHAR(64) NOT NULL UNIQUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Enforce one row per user (lookups by user_id).
CREATE UNIQUE INDEX IF NOT EXISTS stripe_customers_user_id_key
    ON stripe_customers (user_id);
-- Webhooks look up by Stripe customer id.
CREATE INDEX IF NOT EXISTS idx_stripe_customers_stripe_id
    ON stripe_customers (stripe_customer_id);

-- ─── subscriptions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
    id                   SERIAL PRIMARY KEY,
    user_id              INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    tier                 tier NOT NULL DEFAULT 'trial',
    stripe_subscription_id VARCHAR(64),
    stripe_price_id      VARCHAR(64),
    status               VARCHAR(24),
    current_period_end   TIMESTAMPTZ,
    trial_turns_used     INTEGER NOT NULL DEFAULT 0,
    interval             VARCHAR(8),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One subscription row per user (the source of truth for tier).
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_key
    ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
    ON subscriptions (user_id);

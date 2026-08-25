import { eq } from "drizzle-orm";
import { db, systemSettings } from "../db/index.js";

/**
 * Generic DB-backed system settings store with an in-memory cache.
 *
 * V2 note: the v1 helpers getTrialCap(), getDefaultModel(), and
 * getSystemPrompt() were removed — V2 drops the trial cap (every tenant
 * brings their own OpenRouter key), the v1 default model, and the
 * admin-overridable prompt (the admin dashboard was dropped; the V2 agent
 * system prompt is built per-run by buildSystemPrompt() in
 * config/systemPrompt.ts). Keep this module for any future DB-backed settings.
 */

const cache = new Map<string, string>();

export async function getSetting(key: string): Promise<string | null> {
  if (cache.has(key)) return cache.get(key)!;
  const rows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  const value = rows[0]?.value ?? null;
  if (value !== null) cache.set(key, value);
  return value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(systemSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } });
  cache.set(key, value);
}

// ─── Free-access mode ────────────────────────────────────────────────────────
// While GenWhisperer is gathering testimonials, access is free: the trial turn
// cap stops being a paywall and becomes the point where a user switches from
// our platform OpenRouter key to their own. Stored in system_settings so it can
// be flipped off (restoring the paid gate) without a redeploy, and DEFAULTED ON
// in code so it works with no DB row present — no migration required.
export const FREE_MODE_KEY = "free_mode";

/** Email address users send testimonials to (surfaced in the free-access banner). */
export const TESTIMONIAL_EMAIL =
  process.env.TESTIMONIAL_EMAIL?.trim() || "support@genwhisperer.com";

/**
 * Whether free-access mode is on. Defaults to TRUE when the setting is absent.
 * Set system_settings.free_mode to "off" (or "false"/"0") to restore paid gating.
 */
export async function isFreeMode(): Promise<boolean> {
  const val = await getSetting(FREE_MODE_KEY);
  if (val === null) return true;
  const v = val.trim().toLowerCase();
  return v !== "off" && v !== "false" && v !== "0";
}

export function invalidateCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}

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

export function invalidateCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}

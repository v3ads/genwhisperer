import { eq } from "drizzle-orm";
import { db, systemSettings } from "../db/index.js";

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

export async function getTrialCap(): Promise<number> {
  const val = await getSetting("trial_message_cap");
  return val ? parseInt(val, 10) : 5;
}

export async function getDefaultModel(): Promise<string> {
  return (await getSetting("default_model")) ?? "deepseek/deepseek-v4-pro";
}

export function invalidateCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}

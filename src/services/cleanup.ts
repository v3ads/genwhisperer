import cron from "node-cron";
import { lt } from "drizzle-orm";
import { db, magicLinks, revokedSessions } from "../db/index.js";

/**
 * Bound the auth bookkeeping tables. With 1-year sessions the revocation
 * blocklist would otherwise grow unbounded, and consumed/expired magic links
 * are never read again. Both are pruned safely (only rows already past their
 * expiry are removed).
 */
async function pruneExpired(): Promise<void> {
  const now = new Date();
  try {
    await db.delete(revokedSessions).where(lt(revokedSessions.expiresAt, now));
    await db.delete(magicLinks).where(lt(magicLinks.expiresAt, now));
  } catch (err) {
    console.error("[Cleanup] Failed to prune expired rows:", err);
  }
}

/** Schedule the daily prune and run one pass shortly after boot. */
export function startCleanupJobs(): void {
  // Every day at 03:17 UTC (off-peak, avoids the top of the hour).
  cron.schedule("17 3 * * *", () => {
    void pruneExpired();
  });

  // One pass at startup so a long-running deploy doesn't wait a full day.
  setTimeout(() => void pruneExpired(), 30_000).unref();
}

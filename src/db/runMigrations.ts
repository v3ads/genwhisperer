/**
 * Shared database migration runner.
 *
 * Applies all pending Drizzle migrations from drizzle/migrations against the
 * Neon database identified by NEON_DATABASE_URL. Migrations are idempotent
 * (every statement uses IF NOT EXISTS guards), so running on every startup is
 * safe and also self-heals any drift.
 *
 * This module is intentionally free of process.exit() so it can be awaited
 * from the server startup sequence (src/index.ts) as well as from the
 * standalone CLI runner (src/db/migrate.ts). A migration failure at startup
 * is fatal and stops the server from binding — better to fail loud than to
 * serve an app whose schema doesn't match its code.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run all pending DB migrations. Resolves on success, rejects on failure.
 * The migrations folder is resolved relative to this compiled file
 * (dist/db/runMigrations.js -> ../../drizzle/migrations at the project root),
 * which works in both the local tsx environment and the Railway runtime image.
 */
export async function runMigrations(): Promise<void> {
  if (!process.env.NEON_DATABASE_URL) {
    throw new Error("NEON_DATABASE_URL is not set; cannot run migrations.");
  }
  console.log("🔄 Running database migrations...");
  const sql = neon(process.env.NEON_DATABASE_URL);
  const db = drizzle(sql);
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../drizzle/migrations"),
  });
  console.log("✅ Migrations complete.");
}

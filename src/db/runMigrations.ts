/**
 * Shared database migration runner.
 *
 * Applies all pending Drizzle migrations against the Neon database identified
 * by NEON_DATABASE_URL. Migrations are idempotent (every statement uses IF
 * NOT EXISTS guards), so running on every startup is safe and self-heals drift.
 *
 * This module is intentionally free of process.exit() so it can be awaited
 * from the server startup sequence (src/index.ts) as well as from the
 * standalone CLI runner (src/db/migrate.ts). A migration failure at startup
 * is fatal and stops the server from binding — better to fail loud than to
 * serve an app whose schema doesn't match its code.
 */
import { existsSync } from "fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the Drizzle migrations folder.
 *
 * In production (Railway Railpack image) the build step copies
 * drizzle/migrations into dist/migrations, and __dirname is dist/db, so the
 * migrations sit at ../migrations relative to this compiled file. Railpack ships
 * dist/ but NOT the project-root drizzle/ folder, so the dist copy is essential.
 *
 * In local tsx dev, __dirname is src/db and the migrations live at the project
 * root in drizzle/migrations (../../drizzle/migrations). The dist copy does
 * not exist yet, so we fall back to the source folder.
 *
 * Tries the production path first, falls back to the dev path.
 */
function resolveMigrationsFolder(): string {
  const prodPath = path.resolve(__dirname, "../migrations");
  if (existsSync(prodPath)) return prodPath;
  const devPath = path.resolve(__dirname, "../../drizzle/migrations");
  if (existsSync(devPath)) return devPath;
  // If neither exists, return the prod path so the error message points at the
  // expected production location (more actionable than a src-relative path).
  return prodPath;
}

/**
 * Run all pending DB migrations. Resolves on success, rejects on failure.
 */
export async function runMigrations(): Promise<void> {
  if (!process.env.NEON_DATABASE_URL) {
    throw new Error("NEON_DATABASE_URL is not set; cannot run migrations.");
  }
  const migrationsFolder = resolveMigrationsFolder();
  console.log(`🔄 Running database migrations from ${migrationsFolder}...`);
  const sql = neon(process.env.NEON_DATABASE_URL);
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder });
  console.log("✅ Migrations complete.");
}


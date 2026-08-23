import "dotenv/config";
import { runMigrations } from "./runMigrations.js";

// Standalone CLI runner: `npm run db:migrate` -> tsx src/db/migrate.ts.
// The shared runMigrations() logic lives in runMigrations.ts so the server
// startup sequence (src/index.ts) can also await it without process.exit.
runMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  });

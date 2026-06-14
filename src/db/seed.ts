import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { systemSettings } from "./schema.js";
import { sql } from "drizzle-orm";

const DEFAULT_SETTINGS = [
  { key: "trial_message_cap", value: "5" },
  { key: "default_model", value: "deepseek/deepseek-v4-pro" },
  { key: "brevo_sender_name", value: process.env.BREVO_SENDER_NAME ?? "Geny" },
  { key: "brevo_sender_email", value: process.env.BREVO_SENDER_EMAIL ?? "support@genwhisperer.com" },
  { key: "getresponse_list_id", value: process.env.GETRESPONSE_LIST_ID ?? "" },
];

async function seed() {
  console.log("🌱 Seeding database...");
  const client = neon(process.env.NEON_DATABASE_URL!);
  const db = drizzle(client);

  for (const setting of DEFAULT_SETTINGS) {
    await db
      .insert(systemSettings)
      .values(setting)
      .onConflictDoNothing({ target: systemSettings.key });
    console.log(`  ✓ ${setting.key}`);
  }

  console.log("✅ Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});

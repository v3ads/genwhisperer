import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, genesisProjects } from "../db/index.js";
import { sendEmail } from "./brevo.js";

export const SUPPORT_MESSAGE =
  "We couldn't complete your request. Please contact support@genwhisperer.com, and we'll continue once support has replied.";

export interface FailureDetails {
  error: unknown;
  method: string;
  path: string;
  projectId?: number;
  projectName?: string;
  userId?: number;
  requestId?: string;
  occurredAt?: Date;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] ?? char);
}

function describe(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw
    .replace(/(api[_-]?key|token|authorization|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/https?:\/\/\S+\?\S+/gi, "[URL with query redacted]")
    .slice(0, 400);
}

/** Best effort: a failed alert must never replace the user's error response. */
export async function reportUnexpectedError(details: FailureDetails): Promise<void> {
  const requestId = details.requestId ?? randomUUID();
  const occurredAt = (details.occurredAt ?? new Date()).toISOString();
  let projectName = details.projectName;
  if (!projectName && details.projectId && details.userId) {
    try {
      const [project] = await db
        .select({ name: genesisProjects.name })
        .from(genesisProjects)
        .where(and(eq(genesisProjects.id, details.projectId), eq(genesisProjects.userId, details.userId)))
        .limit(1);
      projectName = project?.name;
    } catch (error) {
      console.error("[Error alert] Project lookup failed:", error instanceof Error ? error.message : String(error));
    }
  }

  const fields = [
    `Time (UTC): ${occurredAt}`,
    `Project: ${projectName ?? "Unavailable"}${details.projectId ? ` (ID ${details.projectId})` : ""}`,
    `Request: ${details.method} ${details.path}`,
    `Description: ${describe(details.error)}`,
    `Reference: ${requestId}`,
  ];
  const body = fields.join("\n");
  try {
    await sendEmail({
      to: "vipaymanshalaby@gmail.com",
      subject: `[GenWhisperer] Request failed (${requestId})`,
      textContent: body,
      htmlContent: `<pre style="font-family: sans-serif; white-space: pre-wrap">${escapeHtml(body)}</pre>`,
    });
  } catch (error) {
    console.error("[Error alert] Email delivery failed:", error instanceof Error ? error.message : String(error));
  }
}

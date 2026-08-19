/**
 * Structured, privacy-safe launch observability for agent troubleshooting.
 *
 * These events are written to application logs for the launch period. Never
 * include prompts, email addresses, API keys, Genesis tokens, tool arguments,
 * tool results, authorization headers, or raw upstream response bodies.
 */

export type AgentLaunchEvent =
  | "request_received"
  | "request_rejected"
  | "preflight_complete"
  | "stream_started"
  | "stream_closed"
  | "genesis_connect_started"
  | "genesis_connect_succeeded"
  | "genesis_connect_failed"
  | "genesis_context_started"
  | "genesis_context_succeeded"
  | "genesis_context_failed"
  | "openrouter_attempt_started"
  | "openrouter_attempt_succeeded"
  | "openrouter_attempt_failed"
  | "openrouter_retry_scheduled"
  | "tool_started"
  | "tool_succeeded"
  | "tool_failed"
  | "approval_requested"
  | "agent_completed"
  | "agent_failed";

export interface AgentLaunchFields {
  requestId: string;
  event: AgentLaunchEvent;
  userId?: number;
  projectId?: number;
  conversationId?: number | null;
  model?: string;
  effectiveModel?: string;
  toolName?: string;
  attempt?: number;
  maxAttempts?: number;
  httpStatus?: number;
  retryable?: boolean;
  upstreamRequestId?: string;
  durationMs?: number;
  toolCount?: number;
  iterationCount?: number;
  errorName?: string;
  errorMessage?: string;
}

function safeErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/[\r\n]+/g, " ").slice(0, 240);
}

/** Emit one JSON object per line for filtering in Railway production logs. */
export function logAgentLaunch(fields: AgentLaunchFields): void {
  const event = {
    category: "agent_launch",
    timestamp: new Date().toISOString(),
    ...fields,
    errorMessage: safeErrorMessage(fields.errorMessage),
  };
  console.log(JSON.stringify(event));
}

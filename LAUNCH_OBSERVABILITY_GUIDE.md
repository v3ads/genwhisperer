# GenWhisperer Launch Observability Guide

**Author:** Manus AI  
**Purpose:** Provide structured, privacy-safe internal logs for diagnosing agent request failures during the launch phase.

## What the instrumentation records

Every authenticated Builder request receives a server-generated `requestId`. The application writes one JSON object per lifecycle event to Railway logs with the fixed category `agent_launch`. This lets an operator search a single request across preflight, SSE startup, Genesis, OpenRouter, tool execution, retries, completion, and failure.

| Lifecycle area | Events |
|---|---|
| Request preflight | `request_received`, `request_rejected`, `preflight_complete` |
| Stream lifecycle | `stream_started`, `stream_closed` |
| Genesis | `genesis_connect_started`, `genesis_connect_succeeded`, `genesis_connect_failed`, `genesis_context_started`, `genesis_context_succeeded`, `genesis_context_failed` |
| OpenRouter | `openrouter_attempt_started`, `openrouter_attempt_succeeded`, `openrouter_attempt_failed`, `openrouter_retry_scheduled` |
| Agent tools | `tool_started`, `tool_succeeded` |
| Final outcome | `agent_completed`, `agent_failed` |

## Fields available for diagnosis

The following structured fields are safe to filter in Railway: `requestId`, numeric `userId`, `projectId`, `conversationId`, model ID, effective provider model, OpenRouter attempt number, maximum attempts, HTTP status, retryability, upstream request ID, elapsed duration, tool name, tool count, iteration count, and a sanitized error name/message.

## Explicit privacy boundaries

> These logs must never contain user prompts, assistant responses, email addresses, API keys, Genesis tokens, authorization headers, tool arguments, tool results, or raw provider response bodies.

Error messages are flattened to one line and capped at 240 characters. Model IDs and internal numeric identifiers are logged because they are necessary for routing and troubleshooting, but customer content is excluded.

## Railway troubleshooting workflow

Use the latest production log stream and filter by `"category":"agent_launch"`. Then search the same `requestId` to reconstruct a failing turn.

| Symptom | Log pattern | Interpretation |
|---|---|---|
| Browser received a pre-stream error | No `stream_started` after `request_received` | The request failed in preflight or before the application stream began. |
| Genesis token / MCP issue | `genesis_connect_failed` | Inspect sanitized error name and message; regenerate or reconnect the Genesis token if indicated. |
| Context retrieval problem | `genesis_context_failed` followed by later activity | Non-fatal; the model can continue without preloaded context. |
| OpenRouter transient error | `openrouter_attempt_failed` followed by `openrouter_retry_scheduled` | The retry layer is operating normally. |
| All model attempts failed | Final `openrouter_attempt_failed` and `agent_failed` | Use status, upstream request ID, model, and retryability when investigating OpenRouter. |
| Tool workflow delay or failure | `tool_started` without expected follow-up, or `agent_failed` | Check the tool name and duration; customer data remains excluded. |

## Launch operations

During the launch period, retain Railway logs long enough to compare recurring `requestId` traces and identify repeated model, Genesis, or edge patterns. If a persistent category emerges, promote the relevant error counters and durations to a durable metrics system before reducing log verbosity.

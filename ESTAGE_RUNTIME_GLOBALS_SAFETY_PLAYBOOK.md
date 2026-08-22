# eStage Runtime Globals: Defensive Integration Safety Playbook

**Purpose:** This playbook defines how GenWhisperer should generate code for eStage published-site runtime APIs without turning unavailable features, visitor limits, connector issues, or authentication conditions into broken user experiences.

## Core Rule

Every eStage runtime global is **feature-gated**. Generated code must treat its availability as an optional runtime capability, not as a guaranteed dependency. The platform documentation explicitly directs developers to call these APIs defensively and never place provider credentials in browser code.[1]

> **Generation policy:** Prefer a platform runtime module over a hand-rolled browser-side API integration, but make the module’s absence a recoverable UI state rather than a crash.

## Failure-Mode Matrix

| Failure mode | Affected API surface | User-facing symptom if unhandled | Safe GenWhisperer rule |
|---|---|---|---|
| Feature disabled or module unavailable | All `window.estage*` globals | `TypeError` from calling `undefined` | Feature-detect every global and method before invoking it. |
| Feature enabled after a settings change or delayed runtime installation | All globals | Call happens before module is ready | Resolve capability at action time, not only at component mount; offer a retry action. |
| AI assistant disabled | `window.estageAI` | AI buttons fail or silently do nothing | Disable the feature gracefully and explain that AI Assistant must be enabled in eStage settings. |
| AI spending cap, balance, or visitor-rate limit reached | `window.estageAI` | Rejected AI call after user supplies input | Catch the rejected promise and show a concise availability message. Do not retry automatically because the failure may be a quota decision. |
| Unsupported or oversized AI input | `vision`, `readDocument`, `image` | Rejection after a large file or image | Validate file type and size client-side where known; preserve the user’s input and offer a smaller-file alternative. |
| Connector not configured or disabled | `estageConnector*` | Lead, notification, or data-sync action fails | Do not claim success. Show a non-sensitive configuration-needed state and preserve the primary user action where possible. |
| Relay, external-provider, or network failure | `estageConnector*` | An action may be ambiguous: it may have reached the provider even when response handling failed | Retry only idempotent reads. Never automatically retry outbound notifications, payment-like requests, creates, or uploads without an idempotency design. |
| Member not signed in | `window.estageCommunity` writes | Posting/commenting/uploading fails for an anonymous visitor | Require signed-in state before rendering a write control, then preserve the draft and prompt the user to sign in. |
| Community read pagination or stale cursor | `fetchThreads` and related reads | Duplicate items, missing pages, or broken infinite scroll | Treat cursors as opaque, deduplicate by record ID, and reset pagination on filter changes. |
| Funnel context absent | `window.estageFunnel` | Conversion event calls do not provide meaningful attribution | Emit funnel events only from a known funnel step and keep core UI functional when tracking is unavailable. |
| Locale/personalization configuration absent | Locale and personalization globals | Incorrect language/audience assumptions | Read active configuration defensively; default to the page’s base copy instead of inventing a locale or audience. |
| Browser privacy, script blockers, offline state, or client navigation | All browser globals | Promise rejection, missing module, or interrupted call | Use `try/catch`, maintain local UI state, expose a retry for idempotent reads, and log only safe operational metadata. |

## Baseline Capability Wrapper

GenWhisperer should generate a small wrapper rather than scattering optional chaining through business logic.

```ts
type CapabilityResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "UNAVAILABLE" | "FAILED"; message: string };

export async function callEstageAI<T>(
  operation: () => Promise<T>,
  unavailableMessage = "AI is not enabled for this site."
): Promise<CapabilityResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch {
    return {
      ok: false,
      code: "FAILED",
      message: "This AI action is temporarily unavailable. Please try again shortly.",
    };
  }
}

export async function summarizeArticle(text: string) {
  if (!window.estageAI?.summarize) {
    return {
      ok: false as const,
      code: "UNAVAILABLE" as const,
      message: "AI summaries are not enabled for this site.",
    };
  }

  return callEstageAI(() => window.estageAI.summarize(text));
}
```

The wrapper must not expose raw connector errors, authorization headers, provider payloads, secret identifiers, or internal configuration details in the browser UI.

## Connector-Specific Rules

Connector behavior has an important delivery distinction. `estageConnector` is fire-and-forget, whereas `estageConnectorFetch` returns a relay response envelope.[1] GenWhisperer should generate `estageConnectorFetch` only when a page genuinely needs a response. It should use fire-and-forget only for non-critical notifications where the product can honestly say the action was queued, not confirmed.

For outbound actions, generated code should use an explicit user intent, a disabled-in-flight control, a deterministic client request identifier where the configured connector supports it, and an error state that avoids accidental duplicate sends. For reads, a bounded retry can be appropriate; for writes, creates, uploads, or notification sends, a user-driven retry is safer.

## Community-Specific Rules

Community reads may be available to anonymous visitors, but posting, commenting, and image upload require a signed-in member.[1] Generated components should therefore split read and write states. A post composer should keep a draft locally, block submission without authentication, explain the sign-in requirement, and resume the draft after sign-in if the hosting application provides a return flow.

## Funnel and Analytics Rules

Funnel analytics should be additive. A conversion event must never be required for form submission, purchase progression, or navigation to succeed. Generated code should call tracking after the primary domain action has succeeded, catch failures, and avoid collecting sensitive form content in event data.

```ts
await submitLead(formValues);

try {
  window.estageFunnel?.trackEvent?.("lead_submitted", {
    source: "launch-page",
    variant: currentVariant,
  });
} catch {
  // Analytics must not block the successful lead submission.
}
```

## AI Assistant Cost and Abuse Rules

The eStage AI Assistant runs on the Genesis project owner’s credits, has a monthly cap, applies a per-visitor rate limit, and can decline a call when the balance cannot cover it.[2] [3] GenWhisperer should therefore treat visitor-facing AI as an opt-in capability. Generated product copy should state that the feature uses the project’s configured AI allowance, while code should disable duplicate submissions and provide a respectful quota message instead of retrying a declined call.

GenWhisperer must not route its own Builder-agent work through `window.estageAI`. The runtime helper is for published-site functionality; GenWhisperer needs its own server-side model selection, approval gates, fallback policy, session costs, and launch observability.

## Required GenWhisperer Generation Rules

| Rule | Required behavior |
|---|---|
| Feature detection | Check the exact global and method before use. |
| UI fallback | Explain what is unavailable and what the user can do next. Never fail silently. |
| Action semantics | Retry reads cautiously; do not automatically replay side-effecting calls. |
| Privacy | Never place a provider API key, connector secret, or raw provider error in browser code or UI. |
| Observability | Log safe operation name, capability state, latency bucket, outcome, and a correlation ID; do not log user content or credentials. |
| Progressive enhancement | The core page, form, purchase, or navigation must work even if the optional eStage API does not. |
| Setup transparency | When a feature is unavailable because it is not enabled, provide a clear configuration instruction rather than pretending it is broken. |

## Recommended System-Prompt Addition

> When building for eStage, prefer documented `window.estage*` runtime modules over browser-side API keys. Before calling any module, feature-detect the exact global and method. Build a visible fallback state if it is unavailable. Keep core user flows independent of optional AI, connector, community, funnel, localization, or personalization calls. Never automatically retry a side-effecting connector action. Do not expose credentials, raw provider errors, tool arguments, or response bodies in the browser.

## References

[1] [Platform APIs on a published site](https://knowledge.estage.com/platform/apis/)

[2] [AI Assistant (Site AI)](https://knowledge.estage.com/ai-assistant/)

[3] [What you can build with it](https://knowledge.estage.com/ai-assistant/examples/)

[4] [Connectors overview](https://knowledge.estage.com/connectors/)

[5] [Marketing Funnels overview](https://knowledge.estage.com/funnels/)

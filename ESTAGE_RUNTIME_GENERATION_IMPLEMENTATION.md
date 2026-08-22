# eStage Runtime Generation Safeguards

**Status:** Deployed to production on 2026-08-22 EDT.
**Scope:** GenWhisperer Builder prompt policy and reusable generated-project safety template.

## Purpose

GenWhisperer’s server-side OpenRouter Builder remains responsible for building Genesis projects. This update teaches that Builder how to generate **visitor-facing eStage published-site integrations** without assuming optional runtime modules exist, exposing credentials, or replaying actions that may have side effects.

The policy uses progressive enhancement. A generated project continues to provide its core user journey when an eStage runtime feature has not been enabled, a visitor is offline, or a supported feature fails. Optional integration controls surface a clear inline state rather than a raw platform or provider error.

## Delivered changes

| Area | Implementation | Protection provided |
|---|---|---|
| Live Builder prompt | `src/config/estageRuntimeGuidance.ts` is injected by `buildSystemPrompt()` in `src/config/systemPrompt.ts`. | Every future Builder run receives consistent runtime-global checks, safe fallback, privacy, and retry requirements. |
| Regression coverage | `src/config/systemPrompt.estageRuntime.test.ts` verifies the generated system prompt contains the key safety rules. | Prevents accidental deletion of feature detection, no-secret, no-side-effect-retry, connector presign, and knowledge-base verification instructions. |
| Reusable generated-project template | `templates/estageRuntimeSafeguards.ts` provides framework-neutral capability invocation, structured outcomes, coarse telemetry, and example integrations. | Centralizes defensive calls and prevents direct, unsafe `window.estage*` usage. |
| Retry boundary tests | `templates/estageRuntimeSafeguards.test.ts` is registered in `vitest.config.ts`. | Confirms that a transient idempotent read gets only one retry; side effects, permanent failures, and unavailable capabilities do not. |
| Implementation references | The `ESTAGE_RUNTIME_*` and `ESTAGE_API_*` Markdown files retain the researched runtime capability map, risk analysis, and adoption priorities. | Preserves the reasoning and exact integration boundary for future product work. |
| Declaration-build portability | Explicit `ReturnType` annotations are used for the Express app and route routers. | Makes TypeScript declaration output independent of package-manager-specific inferred paths; it does not change request handling. |

## Runtime contract for generated projects

| Condition | Generated behavior |
|---|---|
| Runtime feature is unavailable | Check the exact global and method before invoking it. Return or render an `UNAVAILABLE` state, explain the required project setup, and retain the normal page workflow. |
| Browser is offline | Return an `OFFLINE` state without invoking the capability. Keep drafts and selected files in the UI. |
| Supported capability rejects | Return a safe `FAILED` message, emit only coarse secret-safe telemetry, and preserve visitor input. |
| Idempotent read has a transient network interruption | Make at most two total attempts, with one bounded retry. |
| AI, connector action, upload, lead capture, payment, community write, or other side effect | Do not automatically replay the call. Give the visitor a deliberate next action instead. |
| Funnel analytics | Treat it as best effort and invoke only after the primary conversion or domain action succeeds. |

## Validation record

The release checkout passed the following checks after the update:

```bash
pnpm run typecheck
pnpm run build:server
pnpm exec vitest run src/config/systemPrompt.estageRuntime.test.ts templates/estageRuntimeSafeguards.test.ts
git diff --check
```

The focused test run completed with **2 test files and 5 tests passing**. The complete test run completed with **5 test files and 15 tests passing**. The server declaration build also passed after the explicit type annotations were added.

## Deployment confirmation

Commit `dca3e99` (`Add safe eStage runtime generation guidance`) was pushed to `main`. Railway reported the matching deployment as **ACTIVE** and **Deployment successful** for the `genwhisperer-web` production service. The public health endpoint then returned `{"status":"ok","env":"production"}`.

## Release boundary

This update changes guidance for **future GenWhisperer Builder runs** and supplies a template for generated projects. It does **not** retroactively edit previously published Genesis projects. Existing projects should be regenerated or deliberately updated if they need an eStage runtime integration hardened with this pattern.

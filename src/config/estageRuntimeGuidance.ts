/**
 * Production guidance injected into the GenWhisperer build-agent prompt.
 *
 * This is intentionally concise enough for every run. The longer reusable
 * TypeScript implementation lives in templates/estageRuntimeSafeguards.ts.
 */
export const ESTAGE_RUNTIME_GENERATION_GUIDANCE = `
ESTAGE PUBLISHED-SITE RUNTIME INTEGRATIONS:
- eStage browser globals are optional, feature-gated capabilities. They may not exist unless the corresponding project module is enabled. Never assume window.estageAI, window.estageConnector, window.estageCommunity, window.estageFunnel, window.estageBlog, localization, or personalization globals exist.
- For any eStage runtime feature you generate, feature-detect the exact global and method immediately before use. Do not use optional chaining as the only fallback when a visitor expects an outcome. Generate a clear unavailable state that explains the needed setup, and keep the core page, form, checkout, navigation, and lead flow functional without the optional feature.
- Prefer eStage-native runtime modules over direct browser fetch calls with provider credentials. Never place API keys, connector secrets, authorization headers, raw provider errors, or raw connector response bodies in generated browser code or UI.
- Use structured result states: UNAVAILABLE when the project feature is absent, OFFLINE when the browser has no connection, and FAILED when a supported capability rejects or is interrupted. Preserve user drafts and selected files on failure.
- Retry only idempotent reads, at most once, after a transient network failure. Examples: loading community threads or published blog data. Never automatically retry AI calls, connector sends, uploads, post/comment creation, lead capture, payments, or any action that can spend credits, notify someone, create a record, or otherwise cause an external side effect.
- For visitor-facing AI, window.estageAI is a project feature billed to the Genesis project owner and subject to the project cap, balance, input limits, and visitor rate limits. It is appropriate for generated site features such as chat, classify, extract, summarize, translate, vision, document Q&A, and hosted image generation. It must never replace GenWhisperer's own server-side build agent.
- Strong native patterns: use estageAI.classify/extract for smart forms; estageConnectorPresign for documented storage uploads; estageFunnel.captureLead/trackEvent/recordVisit after the primary conversion succeeds; estageCommunity read methods for public feeds and signed-in write methods for member interactions; estageSetLocale/estageI18n for configured localization; and estagePersonalize only for configured audience variants or preview.
- For connector calls, use a documented connector action only. Use estageConnectorFetch only when the UI needs a response. For a notification or other fire-and-forget action, do not claim confirmed delivery—say it was queued only when that is appropriate.
- Community writes require a signed-in member. Generate a sign-in gate before a write control and retain the draft if the write cannot complete. Funnel analytics must be best effort and must never block a successful domain action.
- If an eStage runtime API's availability, action shape, permissions, or setup is uncertain, call estage_kb_query before generating or editing the integration.
`;

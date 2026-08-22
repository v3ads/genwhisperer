# eStage API Opportunities for GenWhisperer

**Prepared:** 2026-08-22 EDT
**Scope:** eStage published-site runtime APIs, AI Assistant, connector relay, and Marketing Funnels documentation.

## Executive Recommendation

The strongest opportunity is **not** a new GenWhisperer backend integration. It is a **capability-aware project-generation layer**: teach GenWhisperer to recognize when an eStage-native module is the secure, idiomatic way to implement a requested site feature and to generate defensive, feature-gated code for it.

> eStage’s runtime APIs are most valuable to GenWhisperer as a secure implementation target inside projects. They should not replace GenWhisperer’s server-side OpenRouter agent, which has distinct provider choice, billing, tool approval, and launch-observability requirements.

## Prioritized Opportunities

| Priority | Opportunity | Product value | Recommended implementation | Key constraint |
|---:|---|---|---|---|
| 1 | **Capability-aware eStage code generation** | Prevents insecure client-side API keys and makes generated projects use native eStage features correctly. | Add a concise runtime-module playbook to the GenWhisperer system prompt and project templates. Use defensive optional chaining, such as `window.estageAI?.ask?.(...)`. | Each global exists only if the corresponding project feature is enabled. |
| 2 | **Connector-aware integration patterns** | Lets users request Slack, Notion, Sheets, Shopify, storage, or messaging behavior without pasting credentials into project code. | Detect integration intent, recommend/configure the appropriate eStage connector workflow, and generate calls through `window.estageConnector` or its fetch/presign variants. | Connector actions must match the configured connector’s documented schema; do not invent generic actions. |
| 3 | **Funnel-aware launch generation** | Makes GenWhisperer more valuable for product launches by generating landing pages that report conversion events into eStage analytics. | Add a “launch funnel” build mode or prompt pattern that emits `window.estageFunnel.trackEvent`, `captureLead`, and `recordVisit` only when the page is part of an enabled funnel. | The Funnel module must be active and the generated page must be a funnel step. |
| 4 | **Visitor-facing AI feature recipes** | Lets generated sites add chat, smart forms, document Q&A, vision, translation, and hosted image generation with no exposed provider key. | Offer explicit recipes such as “add an AI support chat” or “classify contact-form submissions.” Generate `window.estageAI` calls and setup instructions. | Usage is billed to the Genesis project owner, subject to caps and visitor rate limits; require explicit user confirmation before enabling paid AI features. |
| 5 | **Community-powered site features** | Enables community feeds, comments, member posts, and image uploads in projects that use eStage Community. | Add templates for a recent-discussion module, post composer, or comment component powered by `window.estageCommunity`. | Writes require a signed-in community member and the Community toolkit must be installed. |
| 6 | **Localized and personalized generated experiences** | Allows generated apps and sites to adapt content without duplicating translation or experimentation systems. | Where requested, generate a locale switcher using eStage locale functions and audience variants through `window.estagePersonalize`. | Both localization and personalization must be configured in the project first. |

## Recommended Near-Term Roadmap

### Release 1: Safe runtime-module guidance

Add a small, capability-aware instruction block to the agent system prompt. The block should tell the model to prefer eStage runtime globals over browser-side API-key implementations, check feature availability defensively, and present the user with the required eStage setting when a module is unavailable. This is the highest-value, lowest-risk improvement because it sharpens the output of the product users already have.

### Release 2: Connector and funnel build intents

Add intentional build patterns rather than a broad generic integration switch. For example, requests such as “notify my team on each lead,” “save leads to Notion,” or “build a product launch funnel” should select a guided connector or funnel pattern. The model should still query the eStage knowledge base before a connector write when the action schema or setup is uncertain.

### Release 3: Explicit visitor-AI recipes

Expose optional AI recipes in the Builder: support chat, smart intake form, document Q&A, image alt-text helper, and image generation. These should be opt-in because platform AI charges the Genesis project owner and because the AI Assistant feature has its own monthly cap, visitor rate limit, and input-size limits.

## What Not to Do

Do not route GenWhisperer’s own build-agent requests through `window.estageAI`. That helper is intended for published-site behavior and is billed to the project owner; GenWhisperer’s server-side agent must keep its existing model selection, retry/fallback controls, approval gates, session-cost tracking, and production observability.

Do not generate direct `fetch` calls with third-party secrets in site code. The eStage connector relay exists to keep credentials encrypted server-side and pins each connector to its intended destination.

Do not assume a global runtime API exists. Generated code must use defensive calls and user-facing fallback states, because each API becomes available only when its project feature is enabled.

## Suggested Product Copy

A useful Builder suggestion could read:

> “Make this an eStage-native implementation: use secure platform connectors, funnel analytics, community modules, and optional visitor AI where they fit—never expose API keys in the browser.”

## References

[1] [Platform APIs on a published site](https://knowledge.estage.com/platform/apis/)

[2] [AI Assistant (Site AI)](https://knowledge.estage.com/ai-assistant/)

[3] [What you can build with it](https://knowledge.estage.com/ai-assistant/examples/)

[4] [Connectors overview](https://knowledge.estage.com/connectors/)

[5] [Marketing Funnels overview](https://knowledge.estage.com/funnels/)

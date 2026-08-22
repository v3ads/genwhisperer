# eStage Platform API Research Notes

Source reviewed: https://knowledge.estage.com/platform/apis/

## Runtime API capabilities

- `window.estageAI` is available when the AI Assistant feature is enabled. Its calls run server-side against platform AI, are billed to the project owner, and are bounded by a monthly cap. It offers streaming chat, one-shot ask/generate, classify, extract, summarize, translate, vision/image analysis, document questions, and hosted image generation.
- `window.estageConnector`, `estageConnectorFetch`, and `estageConnectorPresign` provide browser-facing access to configured external services through a server-side secret relay and destination pinning.
- `window.estageCommunity` offers public reads plus signed-in member writes, comments, and image upload for the Community toolkit.
- `window.estageFunnel` supports custom events, lead capture, and visit recording on funnel pages.
- Localization, audience personalization, and blog-reading globals are also exposed when their project features are enabled.

## Security and availability rules

- Every runtime global exists only when its platform feature is enabled; calls should use defensive optional chaining.
- Platform modules should be used rather than exposing credentials in client code.
- Projects can also be driven from outside through a custom connector to the Claude app; the documented validated workflow supports reading files, editing pages, generating images, and publishing.

## Initial GenWhisperer relevance

- The strongest immediate fit is better project-aware agent behavior: GenWhisperer can direct generated application code to use safe eStage runtime modules for AI, connectors, analytics, and community features rather than hand-rolled API-key code.
- The platform AI runtime should not replace GenWhisperer’s server-side OpenRouter agent loop without an explicit product decision, because its billing sits with the Genesis project owner and its availability depends on the AI Assistant feature.
- Connector, funnel, and community APIs are candidates for capability-aware prompts, tool recommendations, and generated-project integration patterns.

## Additional capability and product-fit findings

The AI Assistant documentation clarifies that the runtime AI helper is designed for visitor-facing product features such as site chat, smart forms, summaries, translations, visual analysis, document Q&A, and image generation. It runs on Genesis credits, has Fast and Smart model modes, enforces monthly spend caps and per-visitor rate limits, and does not currently auto-index an entire site. For GenWhisperer, this is a complementary generated-project capability rather than a substitute for the server-side OpenRouter build agent.

The connector documentation confirms that credentials are encrypted server-side, injected by a Genesis relay, and pinned to the configured external service. The current catalog covers messaging, data, commerce, scheduling, reviews, media, and storage systems, including Notion, Google Sheets, Supabase, Firebase, AWS S3, Slack, Discord, Shopify, Airtable, Cal.com, YouTube, Spotify, and ElevenLabs. This is particularly useful as a product-aware capability catalog: GenWhisperer can recommend or generate connector-based project patterns without asking users to expose API keys in frontend code.

The Funnel module documentation describes published multi-step journeys with A/B branches, tracking, integrations, notifications, privacy controls, lead export, and analytics for conversion and drop-off. Steps can reuse pages built inside Genesis projects. For GenWhisperer, the immediate opportunity is to add a capability-aware prompt pattern that creates conversion instrumentation with `window.estageFunnel` when a user is building a landing page, checkout flow, or product launch sequence. It is a product feature recommendation rather than a direct GenWhisperer backend integration.

## Defensive-runtime constraints for failure analysis

The platform API overview explicitly requires feature detection because a runtime global exists only when its corresponding project feature is enabled. The AI Assistant documentation adds that calls can be declined after the monthly cap is reached, when the project balance cannot cover a call, or when per-visitor limits apply; it also documents input-size limits for long text and very large images or PDFs. The Community API documentation states that reads can be anonymous but writes require a signed-in member. The Funnel API is available only on pages included in an enabled funnel. Connector documentation confirms server-side encrypted credentials and a destination-pinned relay, but the reviewed sources do not provide a public, detailed runtime error-envelope specification.

A focused search did not surface an eStage-specific runtime-error or readiness document. Therefore, readiness race conditions, network loss, relay timeouts, and malformed response envelopes should be treated as standard asynchronous JavaScript integration risks and handled defensively with feature detection, explicit user-visible fallback states, bounded retries only for idempotent reads, and structured client telemetry. They should not be presented as documented eStage behavior without additional source confirmation.

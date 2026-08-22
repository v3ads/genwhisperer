# Additional eStage Runtime Method Shortlist for GenWhisperer

**Scope:** Specific callable methods identified in `estage_api_research_notes.md`, evaluated as additions to the broader capability-aware generation roadmap.

## Recommended Shortlist

| Priority | Runtime method | Strong GenWhisperer use case | Guardrail |
|---:|---|---|---|
| 1 | `window.estageAI.classify(text, categories)` | Generate **smart form** patterns that route contact, application, support, or lead submissions into explicit categories. | Feature-detect and treat quota/rate-limit rejection as a user-visible fallback, not a classification result. |
| 1 | `window.estageAI.extract(text, fields)` | Generate a lightweight **unstructured lead intake** flow that converts free text into a structured draft before submission. | Validate extracted fields against the form schema; never treat a missing or malformed field as confirmed user data. |
| 1 | `window.estageConnectorPresign(connector, action, params)` | Generate safe **direct-upload** experiences for user assets, forms, or media while avoiding a custom file-upload backend. | Use only with a documented storage connector action; validate file type and size, and do not expose connector secrets. |
| 1 | `window.estageFunnel.captureLead(...)` | Generate lead capture that reports attribution into eStage funnels rather than only storing a form submission. | Submit the lead first; analytics/capture failure must not block the main conversion flow. |
| 2 | `window.estageFunnel.recordVisit(...)` and `trackEvent(name, data?)` | Generate instrumented landing pages that observe CTA clicks, pricing views, trial starts, and feature engagement. | Record minimal, non-sensitive event properties; never include raw form answers or secrets. |
| 2 | `window.estageCommunity.fetchThreads(...)`, `fetchComments(...)`, and `fetchProfileThreads(...)` | Generate community-derived content blocks: discussions, member activity, topic feeds, and social proof. | Handle opaque cursor pagination, deduplicate records, and keep the page useful when the Community module is absent. |
| 2 | `window.estageCommunity.createPost(...)`, `createComment(...)`, and `uploadImage(...)` | Generate authenticated member engagement features, such as feedback boards or a project showcase. | Require sign-in before writes; persist a local draft when authentication or upload fails. |
| 2 | `window.estageAI.readDocument(file, prompt)` | Generate a **brief-to-site** assistant where visitors upload a PDF or text brief and receive answers or a structured project-intake draft. | Check input limits and file type; provide a clear failure state when the project’s AI allowance is unavailable. |
| 3 | `window.estageAI.vision(image, prompt)` | Generate image-to-alt-text, intake photo analysis, gallery metadata, or accessibility helper features. | Treat output as a draft; do not make high-stakes decisions from vision output alone. |
| 3 | `window.estageAI.image(prompt, { aspectRatio })` | Generate opt-in cover images, avatars, or community-post assets directly inside a published project. | Confirm that image generation is enabled and disclose project-credit usage before enabling a recurring workflow. |
| 3 | `window.estageAI.config` | Generate custom AI UI that inherits the configured assistant name, greeting, suggestions, accent, and position. | Use only as presentation configuration; do not assume it means the AI methods are currently callable. |
| 3 | `window.estageBlog.ready`, `posts`, `post`, and `reload` | Generate live content strips, “related articles,” release notes, and content-powered landing pages outside `/blog`. | Await readiness, render an empty state, and treat drafts as unavailable. |
| 3 | `estageSetLocale`, `estageGetLocale`, and `estageI18n` | Generate a locale switcher that uses the platform’s localization system rather than a parallel translation framework. | Render only configured locale options and preserve base content if localization is absent. |
| 3 | `window.estagePersonalize.audience`, `set`, and `off` | Generate audience-variant previews and targeted landing-page copy controls. | Use `set` only for preview/admin behavior; do not let visitors self-select sensitive audiences. |

## Product Packaging Suggestions

The methods are most useful when presented as intentional Builder capabilities rather than as a raw API catalog. Suggested prompts or template toggles include **Smart Lead Form**, **Secure File Upload**, **Funnel Instrumentation**, **Community Feed**, **Document Intake**, **Accessible Image Metadata**, and **Localized Landing Page**.

The first release should target `classify`, `extract`, `estageConnectorPresign`, and `captureLead`. Together, they enable high-value, business-oriented features without adding a new GenWhisperer backend service. The model should first identify whether the necessary eStage module is enabled, then generate an implementation with a visible unavailable state.

## Important Boundary

These runtime methods are for the generated **published project**. GenWhisperer’s Builder itself should retain its existing server-side OpenRouter agent, approval workflow, session-cost reporting, retries, and launch observability. The runtime methods should be selected as secure implementation targets for the applications GenWhisperer creates, not as replacements for the Builder’s own infrastructure.

## References

[1] [Platform APIs on a published site](https://knowledge.estage.com/platform/apis/)

[2] [AI Assistant (Site AI)](https://knowledge.estage.com/ai-assistant/)

[3] [What you can build with it](https://knowledge.estage.com/ai-assistant/examples/)

[4] [Connectors overview](https://knowledge.estage.com/connectors/)

[5] [Marketing Funnels overview](https://knowledge.estage.com/funnels/)

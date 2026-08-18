import { Brand } from "../components/Brand";
import "./Guide.css";

/**
 * Guide — getting your OpenRouter API key.
 *
 * Public page (no auth). Linked from the Profile page (opens in a new tab via
 * target="_blank" on the Profile link). Explains what OpenRouter is, how to
 * join, and how to generate an API key — with illustrative UI mockups and
 * every external link opening in a new tab.
 */
const KEYS_IMG =
  "https://pub.hyperagent.com/api/published/pbf01M0AG8DDT_MZ7SN49W648Y4PH9/d270a62f-4f33-47d1-87a7-f46f7829c741.png";
const CREDITS_IMG =
  "https://pub.hyperagent.com/api/published/pbf01M0AG8DDS_MMTW9Z1Z5S48Z2Z7/23ed535f-49ff-49a9-8601-85e351c3a2b9.png";

export default function GuideOpenRouterKey() {
  return (
    <div className="guide-wrap">
      <div className="guide-glow" />
      <nav className="guide-nav">
        <Brand large />
        <div className="sp" />
        <a className="back" href="/">← Back to GenWhisperer</a>
      </nav>

      <main className="guide-main">
        <div className="guide-eyebrow"><span className="d" />Guide</div>
        <h1 className="guide-h1">Getting your OpenRouter API key</h1>
        <p className="guide-lead">
          GenWhisperer connects to your Genesis project and builds it for you using an AI agent.
          The model that drives that agent runs on OpenRouter — you bring your own key so you
          pick the model and control the spend. Here's what OpenRouter is and how to get a key.
        </p>

        {/* ─── What is OpenRouter? ─── */}
        <div className="card" style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 20, margin: "0 0 8px" }}>What is OpenRouter?</h2>
          <p style={{ fontSize: 14.5, color: "var(--text-dim)", lineHeight: 1.6, margin: 0 }}>
            OpenRouter is a unified gateway to dozens of AI models (Claude, GPT, Gemini, GLM,
            DeepSeek, Grok, and more) from a single API. Instead of signing up with each model
            provider separately, you create one OpenRouter account, add prepaid credits, and
            generate one API key that works with every model. You only pay for what you use,
            down to the token.{" "}
            <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)" }}>
              Open openrouter.ai →
            </a>
          </p>
        </div>

        <div className="guide-steps">
          <div className="guide-step">
            <div className="n">1</div>
            <h3>Create an OpenRouter account</h3>
            <p>
              Go to{" "}
              <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)" }}>
                openrouter.ai
              </a>{" "}
              (opens in a new tab) and sign up with Google or email. It's free to create — you
              only pay for the AI usage you actually consume.
            </p>
          </div>

          <div className="guide-step">
            <div className="n">2</div>
            <h3>Add credits</h3>
            <p>
              OpenRouter works on prepaid credits. Open the{" "}
              <a href="https://openrouter.ai/credits" target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)" }}>
                Credits page
              </a>{" "}
              and add a small amount to start — <span className="guide-code">$5</span> is plenty
              for many Genesis build sessions. You can top up anytime.
            </p>
            <img
              src={CREDITS_IMG}
              alt="OpenRouter credits page — add prepaid credits"
              style={{ width: "100%", borderRadius: 10, marginTop: 12, border: "1px solid var(--line)" }}
              loading="lazy"
            />
          </div>

          <div className="guide-step">
            <div className="n">3</div>
            <h3>Generate an API key</h3>
            <p>
              Open{" "}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)" }}>
                openrouter.ai/keys
              </a>{" "}
              and click <b>Create Key</b>. Name it something like{" "}
              <span className="guide-code">genwhisperer</span> so you remember what it's for.
              Copy the key the moment it appears — it starts with{" "}
              <span className="guide-code">sk-or-v1-…</span> and is only shown once.
            </p>
            <img
              src={KEYS_IMG}
              alt="OpenRouter keys page — create and copy an API key"
              style={{ width: "100%", borderRadius: 10, marginTop: 12, border: "1px solid var(--line)" }}
              loading="lazy"
            />
          </div>

          <div className="guide-step">
            <div className="n">4</div>
            <h3>Paste it into GenWhisperer</h3>
            <p>
              Sign in to GenWhisperer, open <b>Profile</b>, and paste the key into the OpenRouter
              API key field. We validate it against OpenRouter before saving, then encrypt it
              (AES-256) and store it server-side. You'll see only a masked version after that.
            </p>
          </div>

          <div className="guide-step">
            <div className="n">5</div>
            <h3>Pick a model</h3>
            <p>
              In Profile, choose a model from the curated dropdown. GenWhisperer only lists
              models that support function-calling and have a large context window (the agent's
              tool payload is big). <b>GLM 5.2</b> is the default — huge context, low cost, a
              solid tool-caller. Claude, GPT-5, Gemini 3, and Grok 4 are in the Recommended
              group too.
            </p>
          </div>
        </div>

        <div className="guide-callout">
          <div className="ic">🔒</div>
          <p>
            <b>How your key is handled.</b> It's encrypted at rest (AES-256-GCM) and only ever
            decrypted in server memory to run the agent loop — it's never sent to your browser
            and never logged. You can remove it anytime from Profile.
          </p>
        </div>

        <div className="guide-callout warn">
          <div className="ic">⚠️</div>
          <p>
            <b>Keep the key private.</b> It spends your OpenRouter credits. Don't paste it into
            screenshots or share it. If it leaks, revoke it at{" "}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)" }}>
              openrouter.ai/keys
            </a>{" "}
            and generate a new one, then update it in Profile.
          </p>
        </div>

        <div className="guide-cta">
          <a className="btn btn-primary" href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
            Open OpenRouter keys →
          </a>
          <a className="btn btn-ghost" href="/sign-in">Sign in to GenWhisperer</a>
        </div>
      </main>
    </div>
  );
}

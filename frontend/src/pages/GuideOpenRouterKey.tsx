import { Brand } from "../components/Brand";
import "./Guide.css";

/**
 * Guide — getting your OpenRouter API key.
 *
 * Public page (no auth). Linked from the Profile page. Walks the user through
 * creating an OpenRouter account, adding credits, and generating an API key,
 * plus what GenWhisperer does with it (encrypted server-side, never sent to
 * the browser, used only to run the AI model that drives the Genesis agent).
 */
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
          GenWhisperer runs an AI agent that builds your Genesis projects. The model that
          drives it runs on OpenRouter — you bring your own key so you pick the model and
          control the spend. Here's how to get one in about two minutes.
        </p>

        <div className="guide-steps">
          <div className="guide-step">
            <div className="n">1</div>
            <h3>Create an OpenRouter account</h3>
            <p>
              Go to{" "}
              <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)" }}>
                openrouter.ai
              </a>{" "}
              and sign up (Google or email). It's free to create — you only pay for the AI
              usage you actually consume.
            </p>
          </div>

          <div className="guide-step">
            <div className="n">2</div>
            <h3>Add credits</h3>
            <p>
              OpenRouter works on prepaid credits. Open the{" "}
              <a href="https://openrouter.ai/credits" target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)" }}>
                Credits
              </a>{" "}
              page and add a small amount to start — <span className="guide-code">$5</span> is
              plenty for many Genesis build sessions. You can top up anytime.
            </p>
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
          </div>

          <div className="guide-step">
            <div className="n">4</div>
            <h3>Paste it into GenWhisperer</h3>
            <p>
              Sign in to GenWhisperer, open <b>Profile</b>, and paste the key into the
              OpenRouter API key field. We validate it against OpenRouter before saving, then
              encrypt it (AES-256) and store it server-side. You'll see only a masked version
              after that.
            </p>
          </div>

          <div className="guide-step">
            <div className="n">5</div>
            <h3>Pick a model</h3>
            <p>
              In Profile, choose a model from the curated dropdown. GenWhisperer only lists
              models that support function-calling and have ≥128k context (the agent's tool
              payload is large). <b>GLM 5.2</b> is the default — huge context, low cost, a
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

import { Brand } from "../components/Brand";
import "./Guide.css";

/**
 * Guide — connecting a Genesis project (MCP link + one-time token).
 *
 * Public page (no auth). Linked from the Projects page and the Add Project
 * form. Walks the user through obtaining the Genesis MCP Server URL and a
 * fresh one-time x-agent-token from Genesis > Account > Integrations >
 * Claude Code. Includes the critical "paste as plain text, not a screenshot"
 * warning (tokens contain both l/1 and O/0; vision transcription fails
 * silently and produces 401s).
 */
export default function GuideGenesisProject() {
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
        <h1 className="guide-h1">Connecting a Genesis project</h1>
        <p className="guide-lead">
          To let GenWhisperer's agent build and edit a Genesis project for you, you connect
          that one project by pasting its <b>MCP Server URL</b> and a fresh{" "}
          <b>one-time token</b>. Each Genesis project has its own URL and token — you can
          connect as many projects as you like, one at a time. Here's how.
        </p>

        <div className="guide-steps">
          <div className="guide-step">
            <div className="n">1</div>
            <h3>Open Genesis and go to Integrations</h3>
            <p>
              Sign in to your eStage account and open the Genesis builder. Click your{" "}
              <b>Account</b> (top right), then go to <b>Integrations</b> →{" "}
              <b>Claude Code</b>. This is the screen that exposes the agent connection for a
              project.
            </p>
          </div>

          <div className="guide-step">
            <div className="n">2</div>
            <h3>Pick the project and copy the MCP Server URL</h3>
            <p>
              From the project dropdown, select the site you want GenWhisperer to work on.
              Copy the <b>MCP Server URL</b> shown on that screen. It looks like this:
            </p>
            <div className="guide-block">https://genesis.estage.com/api/agent/75572/mcp</div>
            <p style={{ marginTop: 10 }}>
              The number in the path (<span className="guide-code">75572</span>) is the
              project ID — that's what makes the URL specific to this one project.
            </p>
          </div>

          <div className="guide-step">
            <div className="n">3</div>
            <h3>Generate a fresh one-time token</h3>
            <p>
              On the same screen, scroll to the <b>Claude Code CLI</b> section. (Optionally)
              label it so you remember it's for GenWhisperer, then click{" "}
              <b>Generate token</b>. <b>Copy it immediately</b> — the token is shown only once
              and can't be retrieved after you leave that screen.
            </p>
          </div>

          <div className="guide-step">
            <div className="n">4</div>
            <h3>Add the project in GenWhisperer</h3>
            <p>
              Sign in to GenWhisperer, open <b>Projects</b>, and click <b>Add project</b>.
              Give it a name (e.g. "Main marketing site"), paste the MCP Server URL, and paste
              the token. We run a quick connection test (the MCP handshake + a tool list)
              before saving — if it passes, the project is connected.
            </p>
          </div>

          <div className="guide-step">
            <div className="n">5</div>
            <h3>Start building</h3>
            <p>
              Open <b>Builder</b>, pick the project from the dropdown, and describe what you
              want in plain English. The agent reads your project, makes edits through
              Genesis's own tools, and asks you to approve before any high-impact action
              (publish, delete, migrate, provision, etc.). Everything is saved to history —
              you can resume any session.
            </p>
          </div>
        </div>

        <div className="guide-callout warn">
          <div className="ic">⚠️</div>
          <p>
            <b>Paste the token as plain text — never from a screenshot.</b> Genesis tokens
            contain both the letter <span className="guide-code">l</span> and the digit{" "}
            <span className="guide-code">1</span>, and both{" "}
            <span className="guide-code">O</span> and{" "}
            <span className="guide-code">0</span>. If you photograph or screenshot the token
            and we transcribe it from the image, a single misread character turns into an{" "}
            <b>Invalid agent token</b> error that's hard to trace. Always copy from the
            Genesis screen and paste directly.
          </p>
        </div>

        <div className="guide-callout">
          <div className="ic">🔒</div>
          <p>
            <b>How your token is handled.</b> It's encrypted at rest (AES-256-GCM) and only
            decrypted in server memory to run the agent loop against your project — it's never
            sent to your browser and never logged. The token is scoped to this one project and
            can't touch any other. You can remove the project anytime from Projects.
          </p>
        </div>

        <div className="guide-callout warn">
          <div className="ic">⟳</div>
          <p>
            <b>Tokens are one-time-use.</b> If the agent reports the token is invalid or
            already consumed, come back to this screen and generate a fresh one, then update
            the project in GenWhisperer (Projects → edit → paste the new token). A consumed
            token can't be reused.
          </p>
        </div>

        <div className="guide-cta">
          <a className="btn btn-primary" href="/sign-in">Sign in to connect a project</a>
          <a className="btn btn-ghost" href="/guide/openrouter-key">Need an OpenRouter key too?</a>
        </div>
      </main>
    </div>
  );
}

import { Brand } from "../components/Brand";
import "./UnderConstruction.css";

/**
 * Under Construction — V2 coming soon.
 *
 * Replaces the v1 landing while GenWhisperer V2 (the Genesis AI Builder
 * agent — a real agent loop that builds/edits Genesis projects) is being
 * built. Existing routes (/sign-in, /auth/verify) and the API (/api/*) stay
 * live so magic-link auth and health checks keep working; only the public
 * landing becomes this page.
 *
 * Rollback to v1: deploy the `v1-final` branch.
 */
export default function UnderConstruction() {
  return (
    <div className="uc-wrap">
      <div className="uc-glow" />

      <nav className="uc-nav">
        <Brand large />
        <div className="sp" />
        <span className="mono" style={{ color: "var(--text-faint)", fontSize: 12.5, letterSpacing: ".04em" }}>
          v2 in progress
        </span>
      </nav>

      <main className="uc-main">
        <div className="uc-eyebrow">
          <span className="d d-pulse" />
          Building V2
        </div>

        <h1 className="uc-h1">
          Gen<b>Whisperer</b> is becoming a <span className="g">Genesis builder</span>.
        </h1>

        <p className="uc-sub">
          V2 connects directly to your Genesis project and builds it for you. A real AI agent
          loop, grounded by the eStage knowledge base, with your projects and history saved.
          We're shipping it now.
        </p>

        <div className="uc-status">
          <div className="uc-bar">
            <div className="uc-bar-fill" />
          </div>
          <div className="uc-meta">
            status: <b>in development</b> &nbsp;·&nbsp; rollback: <b>v1-final</b> branch
          </div>
        </div>

        <div className="uc-features">
          <div className="uc-feat">
            <div className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Agent that builds</h3>
            <p>An AI agent loop that runs real Genesis tool calls against your project — it builds directly, you stay in control.</p>
          </div>
          <div className="uc-feat">
            <div className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <path d="M12 2v20M2 12h20" strokeLinecap="round" />
              </svg>
            </div>
            <h3>Grounded by the KB</h3>
            <p>Consults the eStage knowledge base before uncertain writes, so builds land right the first time.</p>
          </div>
          <div className="uc-feat">
            <div className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18M8 4v5" strokeLinecap="round" />
              </svg>
            </div>
            <h3>Projects &amp; history</h3>
            <p>Save Genesis projects, keep conversation history, and resume sessions across logins.</p>
          </div>
          <div className="uc-feat">
            <div className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Secure by design</h3>
            <p>Your keys and project tokens live encrypted server-side and never reach the browser.</p>
          </div>
        </div>
      </main>

      <footer className="uc-foot">
        GenWhisperer &nbsp;·&nbsp; back soon &nbsp;·&nbsp;{" "}
        <a href="mailto:support@genwhisperer.com">support@genwhisperer.com</a>
      </footer>
    </div>
  );
}

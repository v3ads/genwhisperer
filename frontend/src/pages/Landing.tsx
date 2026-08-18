import { useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { PricingBlock } from "../components/PricingBlock";
import "./Landing.css";

/**
 * V2 public landing — the final ship (replaces the under-construction gate).
 *
 * Reframed: GenWhisperer connects to your Genesis project and builds it for
 * you (NOT a prompt generator). Hero + how-it-works + features + the
 * PricingBlock (public mode, CTAs → /sign-in) + sign-in CTA.
 */
export default function Landing() {
  const nav = useNavigate();
  const go = () => nav("/sign-in");

  return (
    <div className="landing">
      <div className="glow" />

      <nav className="lp-nav">
        <Brand large />
        <div className="lp-links">
          <a onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>How it works</a>
          <a onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })}>Pricing</a>
        </div>
        <button className="signin" onClick={go}>Sign in</button>
      </nav>

      {/* hero */}
      <section className="lp-hero">
        <div className="lp-eyebrow"><span className="d" />For Genesis users on eStage</div>
        <h1 className="lp-h1">
          Tell it what to build.<br /><span className="g">GenWhisperer builds it in Genesis.</span>
        </h1>
        <p className="lp-sub">
          An AI agent that connects directly to your Genesis project and builds it for you — reading
          your code, making edits through Genesis's own tools, and checking the knowledge base before
          uncertain writes. You stay in control; it does the work.
        </p>
        <div className="lp-cta">
          <button className="btn btn-primary" onClick={go}>Start free →</button>
          <button className="btn btn-ghost" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>See how it works</button>
        </div>
        <p className="lp-micro">Free trial · 2 agent turns on us · no card required</p>
      </section>

      {/* how it works */}
      <section className="lp-section" id="how">
        <h2>How it works</h2>
        <p className="lead">Three steps from idea to a built Genesis project.</p>
        <div className="lp-steps">
          <div className="lp-step">
            <div className="n">01</div>
            <h3>Connect your project</h3>
            <p>Paste your Genesis project's MCP link + a one-time token. We connect securely — your credentials stay encrypted server-side and never touch the browser.</p>
          </div>
          <div className="lp-step">
            <div className="n">02</div>
            <h3>Describe what you want</h3>
            <p>Plain English: "add a dark hero section," "build a contact form that emails me," "make the pricing page mobile-friendly." The agent reads your project and plans the edits.</p>
          </div>
          <div className="lp-step">
            <div className="n">03</div>
            <h3>Approve, and it builds</h3>
            <p>The agent makes edits through Genesis's own tools, checks the preview compiles, and asks you to approve before any high-impact action (publish, delete, etc.). History is saved.</p>
          </div>
        </div>

        {/* features */}
        <div className="lp-feats">
          <div className="lp-feat">
            <div className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h3>Builds, not prompts</h3>
            <p>A real agent loop that runs Genesis tool calls against your project — it edits your code and checks the preview, not a prompt to copy elsewhere.</p>
          </div>
          <div className="lp-feat">
            <div className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M12 2v20M2 12h20" strokeLinecap="round" /></svg>
            </div>
            <h3>Grounded by the KB</h3>
            <p>Consults the eStage knowledge base before uncertain writes, so builds land right the first time — no guessing at platform capabilities.</p>
          </div>
          <div className="lp-feat">
            <div className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinejoin="round" /></svg>
            </div>
            <h3>Secure by design</h3>
            <p>Your OpenRouter key and Genesis token are encrypted at rest and decrypted only in server memory to run the agent — never sent to the browser.</p>
          </div>
        </div>
      </section>

      {/* pricing */}
      <section className="lp-pricing" id="pricing">
        <h2>Simple pricing</h2>
        <p className="lead">Start free. Upgrade when you're ready. Cancel anytime.</p>
        <PricingBlock currentTier={null} />
      </section>

      <footer className="lp-foot">
        GenWhisperer &nbsp;·&nbsp; an AI agent that builds your Genesis projects &nbsp;·&nbsp;{" "}
        <a href="mailto:support@genwhisperer.com">support@genwhisperer.com</a>
      </footer>
    </div>
  );
}

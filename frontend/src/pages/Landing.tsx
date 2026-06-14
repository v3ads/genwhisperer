import { useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import "./Landing.css";

export default function Landing() {
  const nav = useNavigate();
  const go = () => nav("/sign-in");

  return (
    <div>
      <div className="glow" />
      <nav className="lp-nav">
        <Brand large />
        <div className="sp" />
        <div className="lp-links">
          <a onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>How it works</a>
          <a onClick={() => document.getElementById("trained")?.scrollIntoView({ behavior: "smooth" })}>Why it's different</a>
        </div>
        <span className="signin" onClick={go} role="button" tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && go()}>Sign in</span>
      </nav>

      <section className="hero">
        <div className="eyebrow"><span className="d" />For Genesis users on E-Stage</div>
        <h1>Genesis builds what you say.<br /><span className="g">GenWhisperer</span> makes you say it right.</h1>
        <p className="sub">
          Genesis picks one build approach per message — and a vague prompt lands in the
          wrong one. GenWhisperer is trained on its exact rules, so your prompt builds right
          the first time.
        </p>
        <div className="cta">
          <button className="btn btn-primary" onClick={go}>Start free →</button>
          <button className="btn btn-ghost" onClick={() => document.getElementById("trained")?.scrollIntoView({ behavior: "smooth" })}>See how</button>
        </div>
        <p className="micro">No card. Five free messages on our key — bring your own to keep going.</p>
      </section>

      <section className="demo">
        <div className="card from">
          <div className="lbl">What you'd type into Genesis</div>
          <p>"add a contact form and make it save the messages and email me"</p>
        </div>
        <div className="arrow">↓</div>
        <div className="card to">
          <div className="lbl">What GenWhisperer hands you</div>
          <pre><span className="t">[estage-dedicated:</span> a contact form with name, email and message fields that stores every submission in a table I can view and emails me each one]</pre>
        </div>
      </section>

      <section className="lp-section" id="trained">
        <h2>Trained on Genesis</h2>
        <p className="lead">It knows the rules that decide whether your build works.</p>
        <div className="grid-3 stack">
          <div className="feat">
            <div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h10" /></svg></div>
            <h3>Knows every tag</h3>
            <p>Routes power features right — <code>[estage-dedicated:]</code> for backends, <code>[product list:]</code> for catalogs, <code>[tracking:]</code> for pixels.</p>
          </div>
          <div className="feat">
            <div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20" /></svg></div>
            <h3>Targets the right scope</h3>
            <p>Knows when you mean a <code>[section:]</code>, a whole <code>[page:]</code>, an <code>[app:]</code>, or a <code>[blog:]</code> — so Genesis builds at the level you intend.</p>
          </div>
          <div className="feat">
            <div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg></div>
            <h3>Interviews, then writes</h3>
            <p>Asks only what matters, then hands you one copy-ready prompt — no trial and error in the builder.</p>
          </div>
        </div>
      </section>

      <section className="lp-section" id="how">
        <h2>How it works</h2>
        <div className="grid-3 stack">
          <div className="step"><div className="n">01</div><h3>Sign in with your email</h3><p>A magic link arrives — no password to remember. Start chatting right away.</p><span className="pill pill-free">5 free messages</span></div>
          <div className="step"><div className="n">02</div><h3>Add your OpenRouter key</h3><p>When the free messages run out, paste your key once. It's encrypted, and you pick the model.</p><span className="pill pill-byok">Your key, your model</span></div>
          <div className="step"><div className="n">03</div><h3>Build with confidence</h3><p>Describe the goal, copy the prompt, paste into Genesis.</p><span className="pill pill-byok">Unlimited</span></div>
        </div>
      </section>

      <section className="final">
        <h2>Stop fighting the builder.</h2>
        <p>For anyone building on E-Stage with Genesis: the difference between three tries and one.</p>
        <button className="btn btn-primary" onClick={go}>Start free →</button>
      </section>

      <footer className="lp-foot">GenWhisperer · trained on Genesis · not affiliated with E-Stage · © 2026</footer>
    </div>
  );
}

import { useState } from "react";
import { auth, ApiError } from "../lib/api";
import { Brand } from "../components/Brand";
import "./Auth.css";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const value = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setErr("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await auth.requestLink(value);
      setSent(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="glow" />
      <div className="auth-card">
        <Brand large />
        {!sent ? (
          <>
            <h1>Sign in</h1>
            <p className="auth-sub">Enter your email and we'll send a one-tap sign-in link. No password needed.</p>
            {err && <div className="banner banner-err">{err}</div>}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email" className="inp" type="email" inputMode="email"
                placeholder="you@example.com" value={email}
                autoComplete="email" autoFocus
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? <span className="spin" /> : "Send sign-in link"}
            </button>
            <p className="auth-foot">By continuing you agree to use GenWhisperer to craft Genesis prompts. We email you a link that expires in 15 minutes.</p>
          </>
        ) : (
          <>
            <h1>Check your email</h1>
            <p className="auth-sub">
              We sent a sign-in link to <b className="mono">{email.trim().toLowerCase()}</b>.
              Open it on this device to continue. The link works once and expires in 15 minutes.
            </p>
            <div className="banner banner-ok">Didn't arrive? Check spam, or request a new link below.</div>
            <button className="btn btn-ghost" onClick={() => setSent(false)}>Use a different email</button>
          </>
        )}
      </div>
    </div>
  );
}

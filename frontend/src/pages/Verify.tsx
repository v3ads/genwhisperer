import { useEffect, useState } from "react";
import { Brand } from "../components/Brand";
import { auth, ApiError } from "../lib/api";
import "./Auth.css";

/**
 * Magic-link landing page. The email link points here:
 *   https://genwhisperer.com/auth/verify?token=<token>
 *
 * We must NOT fetch the verify endpoint — an httpOnly cookie can only be set by
 * a full browser navigation that receives the Set-Cookie header. So we redirect
 * the whole window to the backend, which sets gw_session and 302s to /builder.
 *
 * On the error state (missing/invalid/expired token), a "Resend link" form lets
 * the user request a fresh magic-link without navigating back to /sign-in.
 */
export default function Verify() {
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendErr, setResendErr] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("This sign-in link is missing its token. Request a new link below.");
      return;
    }
    // Same-origin: backend lives behind /api on this domain.
    window.location.href = `/api/auth/verify?token=${encodeURIComponent(token)}`;
  }, []);

  async function resend() {
    const value = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setResendErr("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setResendErr(null);
    try {
      await auth.requestLink(value);
      setResent(true);
    } catch (e) {
      setResendErr(e instanceof ApiError ? e.message : "Could not send link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="glow" />
      <div className="auth-card">
        <Brand large />
        {error ? (
          <>
            <h1>Link problem</h1>
            <p className="auth-sub">{error}</p>
            {resent ? (
              <>
                <p className="auth-sub" style={{ marginBottom: 18 }}>
                  We sent a fresh sign-in link to <b className="mono">{email.trim().toLowerCase()}</b>.
                  Open it on this device to continue.
                </p>
                <a className="btn btn-primary" href="/sign-in">Use a different email</a>
              </>
            ) : (
              <>
                <div className="field" style={{ marginBottom: 16 }}>
                  <label htmlFor="remail">Email</label>
                  <input
                    id="remail"
                    className="inp"
                    type="email"
                    inputMode="email"
                    placeholder="you@example.com"
                    value={email}
                    autoComplete="email"
                    autoFocus
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && resend()}
                  />
                </div>
                {resendErr && <div className="banner banner-err" style={{ marginBottom: 16 }}>{resendErr}</div>}
                <button className="btn btn-primary" onClick={resend} disabled={busy}>
                  {busy ? <span className="spin" /> : "Send new link"}
                </button>
              </>
            )}
          </>
        ) : (
          <div className="verify-state">
            <div className="spin" />
            <p className="auth-sub" style={{ margin: 0 }}>Signing you in…</p>
          </div>
        )}
      </div>
    </div>
  );
}

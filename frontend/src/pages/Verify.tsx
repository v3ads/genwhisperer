import { useEffect, useState } from "react";
import { Brand } from "../components/Brand";
import "./Auth.css";

/**
 * Magic-link landing page. The email link points here:
 *   https://genwhisperer.com/auth/verify?token=<token>
 *
 * We must NOT fetch the verify endpoint — an httpOnly cookie can only be set by
 * a full browser navigation that receives the Set-Cookie header. So we redirect
 * the whole window to the backend, which sets gw_session and 302s to /chat.
 */
export default function Verify() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("This sign-in link is missing its token. Request a new link.");
      return;
    }
    // Same-origin: backend lives behind /api on this domain.
    window.location.href = `/api/auth/verify?token=${encodeURIComponent(token)}`;
  }, []);

  return (
    <div className="auth-wrap">
      <div className="glow" />
      <div className="auth-card">
        <Brand large />
        {error ? (
          <>
            <h1>Link problem</h1>
            <p className="auth-sub">{error}</p>
            <a className="btn btn-primary" href="/sign-in">Request a new link</a>
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

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/request", { email: email.trim().toLowerCase() });
      setSent(true);
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div className="animate-fade-in" style={{ width: "100%", maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ width: 44, height: 44, background: "var(--text)", borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <span style={{ color: "var(--bg)", fontSize: 20, fontWeight: 700 }}>G</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.5px" }}>GenWhisperer</h1>
          <p style={{ color: "var(--text-2)", fontSize: 14, marginTop: 6 }}>Sign in to your account</p>
        </div>

        {sent ? (
          <div style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>📬</div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>Check your inbox</h2>
            <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.6 }}>
              We sent a sign-in link to <strong style={{ color: "var(--text)" }}>{email}</strong>. It expires in 15 minutes.
            </p>
            <button
              onClick={() => { setSent(false); setEmail(""); }}
              style={{ marginTop: 24, color: "var(--text-2)", fontSize: 13, textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <div style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 32 }}>
            <form onSubmit={handleSubmit}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8, color: "var(--text-2)" }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                style={{ marginBottom: 16 }}
              />
              {error && (
                <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#fca5a5", marginBottom: 16 }}>
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading || !email.trim()}
                style={{ width: "100%", background: loading || !email.trim() ? "var(--bg-3)" : "var(--text)", color: loading || !email.trim() ? "var(--text-3)" : "var(--bg)", padding: "12px", borderRadius: 8, fontSize: 14, fontWeight: 600, transition: "all 150ms var(--ease-out)", cursor: loading ? "wait" : "pointer" }}
              >
                {loading ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
            <p style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
              No password required — we'll email you a magic link.
            </p>
          </div>
        )}

        <button
          onClick={() => navigate("/")}
          style={{ display: "block", margin: "24px auto 0", color: "var(--text-3)", fontSize: 13 }}
        >
          ← Back to home
        </button>
      </div>
    </div>
  );
}

import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useEffect } from "react";

export default function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate("/chat", { replace: true });
  }, [user, loading, navigate]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      {/* Nav */}
      <nav style={{ padding: "20px 40px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, background: "var(--text)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "var(--bg)", fontSize: 13, fontWeight: 700 }}>G</span>
          </div>
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-0.3px" }}>GenWhisperer</span>
        </div>
        <button
          onClick={() => navigate("/auth/signin")}
          style={{ background: "var(--text)", color: "var(--bg)", padding: "8px 20px", borderRadius: 8, fontSize: 14, fontWeight: 600, transition: "opacity 150ms" }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
        >
          Sign in
        </button>
      </nav>

      {/* Hero */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 24px", textAlign: "center" }}>
        <div className="animate-fade-in" style={{ maxWidth: 640 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 100, padding: "6px 14px", marginBottom: 32, fontSize: 12, color: "var(--text-2)", letterSpacing: "0.02em" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)", display: "inline-block" }} />
            AI Prompt Assistant for Genesis
          </div>

          <h1 style={{ fontSize: "clamp(36px, 6vw, 64px)", fontWeight: 700, letterSpacing: "-2px", lineHeight: 1.1, marginBottom: 24, color: "var(--text)" }}>
            Prompts that actually<br />
            <span style={{ color: "var(--text-2)" }}>work in Genesis.</span>
          </h1>

          <p style={{ fontSize: 17, color: "var(--text-2)", lineHeight: 1.7, marginBottom: 40, maxWidth: 480, margin: "0 auto 40px" }}>
            GenWhisperer interviews you about what you want to build, then outputs a single, perfectly-tagged prompt ready to paste into Genesis — no guesswork required.
          </p>

          <button
            onClick={() => navigate("/auth/signin")}
            style={{ background: "var(--text)", color: "var(--bg)", padding: "14px 36px", borderRadius: 10, fontSize: 15, fontWeight: 600, letterSpacing: "-0.2px", transition: "transform 150ms var(--ease-out), opacity 150ms" }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.88")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >
            Start for free →
          </button>
          <p style={{ marginTop: 16, fontSize: 13, color: "var(--text-3)" }}>No password required · 5 free messages</p>
        </div>

        {/* Features */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginTop: 80, maxWidth: 800, width: "100%" }}>
          {[
            { icon: "⚡", title: "Instant prompts", desc: "Get a copy-ready Genesis prompt in seconds" },
            { icon: "🎯", title: "Correct tags", desc: "Automatically applies the right bracket tags" },
            { icon: "🔒", title: "Your key, your data", desc: "Bring your own OpenRouter key after the trial" },
          ].map((f) => (
            <div key={f.title} style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 'var(--radius-lg)', padding: "24px", textAlign: "left" }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>{f.icon}</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </main>

      <footer style={{ padding: "24px 40px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "center" }}>
        <span style={{ fontSize: 13, color: "var(--text-3)" }}>© {new Date().getFullYear()} GenWhisperer</span>
      </footer>
    </div>
  );
}

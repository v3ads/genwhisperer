import { useNavigate } from "react-router-dom";

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
      <div>
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: "-4px", color: "var(--bg-3)", marginBottom: 16 }}>404</div>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Page not found</h1>
        <p style={{ color: "var(--text-2)", fontSize: 14, marginBottom: 24 }}>This page doesn't exist.</p>
        <button onClick={() => navigate("/")} style={{ background: "var(--text)", color: "var(--bg)", padding: "10px 24px", borderRadius: 8, fontSize: 14, fontWeight: 600 }}>
          Go home
        </button>
      </div>
    </div>
  );
}

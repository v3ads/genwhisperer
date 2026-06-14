import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, type ChatStatus } from "../lib/api";

export default function Account() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    api.get<ChatStatus>("/chat/status").then(r => setStatus(r.data)).catch(() => {});
  }, []);

  const saveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.post("/account/api-key", { apiKey: apiKey.trim() });
      const { data } = await api.get<ChatStatus>("/chat/status");
      setStatus(data);
      setApiKey("");
      setMessage({ type: "success", text: "API key saved and validated successfully." });
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.error ?? "Failed to save key." });
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    if (!confirm("Remove your API key? You'll revert to trial mode.")) return;
    setRemoving(true);
    try {
      await api.delete("/account/api-key");
      const { data } = await api.get<ChatStatus>("/chat/status");
      setStatus(data);
      setMessage({ type: "success", text: "API key removed." });
    } catch {
      setMessage({ type: "error", text: "Failed to remove key." });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "0 20px" }}>
      {/* Header */}
      <header style={{ maxWidth: 640, margin: "0 auto", padding: "20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
        <button onClick={() => navigate("/chat")} style={{ fontSize: 13, color: "var(--text-2)" }}>← Back to chat</button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Account</span>
        <button onClick={logout} style={{ fontSize: 13, color: "var(--text-3)" }}>Sign out</button>
      </header>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 0" }}>
        {/* Profile */}
        <section style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 24, marginBottom: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 11 }}>Profile</h2>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--bg-3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 600 }}>
              {user?.email?.[0]?.toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 14 }}>{user?.email}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{user?.role === "admin" ? "Administrator" : "User"}</div>
            </div>
          </div>
        </section>

        {/* Usage */}
        {status && (
          <section style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 24, marginBottom: 20 }}>
            <h2 style={{ fontSize: 11, fontWeight: 600, marginBottom: 16, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Usage</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "var(--bg-2)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
                <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-1px" }}>{status.trialMessagesUsed}</div>
                <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>Trial messages used</div>
              </div>
              <div style={{ background: "var(--bg-2)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
                <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-1px" }}>{status.trialMessageCap}</div>
                <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>Free message cap</div>
              </div>
            </div>
            {status.hasOwnKey && (
              <div style={{ marginTop: 12, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 13, color: "#86efac" }}>
                ✓ Using your own OpenRouter key · unlimited messages
              </div>
            )}
          </section>
        )}

        {/* API Key */}
        <section style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 24 }}>
          <h2 style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>OpenRouter API Key</h2>
          <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 20, lineHeight: 1.5 }}>
            Add your own key to get unlimited messages. Get one at{" "}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-2)", textDecoration: "underline" }}>openrouter.ai/keys</a>.
          </p>

          {status?.hasOwnKey && (
            <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-2)" }}>{status.maskedKey}</span>
              <button onClick={removeKey} disabled={removing} style={{ fontSize: 12, color: "var(--danger)", padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.06)" }}>
                {removing ? "Removing…" : "Remove"}
              </button>
            </div>
          )}

          {message && (
            <div style={{ background: message.type === "success" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", border: `1px solid ${message.type === "success" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: message.type === "success" ? "#86efac" : "#fca5a5", marginBottom: 16 }}>
              {message.text}
            </div>
          )}

          <form onSubmit={saveKey}>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-or-v1-…"
              style={{ fontFamily: "var(--font-mono)", fontSize: 13, marginBottom: 12 }}
            />
            <button
              type="submit"
              disabled={saving || !apiKey.trim()}
              style={{ width: "100%", background: saving || !apiKey.trim() ? "var(--bg-3)" : "var(--text)", color: saving || !apiKey.trim() ? "var(--text-3)" : "var(--bg)", padding: "11px", borderRadius: 8, fontSize: 14, fontWeight: 600, transition: "all 150ms" }}
            >
              {saving ? "Validating & saving…" : status?.hasOwnKey ? "Update key" : "Save key"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

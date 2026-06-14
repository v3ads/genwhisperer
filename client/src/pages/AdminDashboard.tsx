import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

interface AdminStats {
  totalUsers: number;
  totalMessages: number;
  trialMessages: number;
  ownKeyMessages: number;
  totalTokens: number;
  usersWithOwnKey: number;
  dailyVolume: { date: string; count: number }[];
}

interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  role: "user" | "admin";
  suspended: boolean;
  createdAt: string;
  lastSignedIn: string | null;
  maskedKey: string | null;
  hasOwnKey: boolean;
  trialMessagesUsed: number;
}

interface Setting {
  key: string;
  value: string;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"overview" | "users" | "settings">("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingEdits, setSettingEdits] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [statsRes, usersRes, settingsRes] = await Promise.all([
          api.get<AdminStats>("/admin/stats"),
          api.get<{ users: AdminUser[] }>("/admin/users"),
          api.get<{ settings: Setting[] }>("/admin/settings"),
        ]);
        setStats(statsRes.data);
        setUsers(usersRes.data.users);
        setSettings(settingsRes.data.settings);
        const edits: Record<string, string> = {};
        settingsRes.data.settings.forEach(s => { edits[s.key] = s.value; });
        setSettingEdits(edits);
      } catch {}
      setLoading(false);
    };
    load();
  }, []);

  const toggleSuspend = async (userId: number, suspended: boolean) => {
    await api.patch(`/admin/users/${userId}/suspend`, { suspended: !suspended });
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, suspended: !suspended } : u));
  };

  const saveSetting = async (key: string) => {
    setSavingSettings(true);
    try {
      await api.patch("/admin/settings", { key, value: settingEdits[key] });
      setSettings(prev => prev.map(s => s.key === key ? { ...s, value: settingEdits[key]! } : s));
    } catch {}
    setSavingSettings(false);
  };

  const tabStyle = (active: boolean) => ({
    padding: "8px 16px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    background: active ? "var(--bg-3)" : "transparent",
    color: active ? "var(--text)" : "var(--text-2)",
    border: "none",
    cursor: "pointer",
    transition: "all 150ms",
  });

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "0 20px" }}>
      <header style={{ maxWidth: 960, margin: "0 auto", padding: "20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate("/chat")} style={{ fontSize: 13, color: "var(--text-3)" }}>← Chat</button>
          <span style={{ color: "var(--border)" }}>|</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Admin Dashboard</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["overview", "users", "settings"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 0" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-3)" }}>Loading…</div>
        ) : (
          <>
            {/* Overview */}
            {tab === "overview" && stats && (
              <div className="animate-fade-in">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 32 }}>
                  {[
                    { label: "Total users", value: stats.totalUsers },
                    { label: "Total messages", value: stats.totalMessages },
                    { label: "Trial messages", value: stats.trialMessages },
                    { label: "Own-key messages", value: stats.ownKeyMessages },
                    { label: "Users with own key", value: stats.usersWithOwnKey },
                    { label: "Total tokens", value: stats.totalTokens.toLocaleString() },
                  ].map(s => (
                    <div key={s.label} style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px" }}>
                      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-1px" }}>{s.value}</div>
                      <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {stats.dailyVolume.length > 0 && (
                  <div style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 24 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 20, color: "var(--text-2)" }}>Daily message volume (last 30 days)</h3>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
                      {stats.dailyVolume.map(d => {
                        const max = Math.max(...stats.dailyVolume.map(x => x.count), 1);
                        const h = Math.max((d.count / max) * 80, 2);
                        return (
                          <div key={d.date} title={`${d.date}: ${d.count}`} style={{ flex: 1, height: h, background: "var(--bg-3)", borderRadius: 2, transition: "background 150ms" }}
                            onMouseEnter={e => (e.currentTarget.style.background = "var(--text-2)")}
                            onMouseLeave={e => (e.currentTarget.style.background = "var(--bg-3)")}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Users */}
            {tab === "users" && (
              <div className="animate-fade-in">
                <div style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["Email", "Role", "Trial used", "Own key", "Status", "Joined", "Actions"].map(h => (
                          <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u, i) => (
                        <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? "1px solid var(--border)" : "none", opacity: u.suspended ? 0.5 : 1 }}>
                          <td style={{ padding: "12px 16px", fontSize: 13 }}>{u.email}</td>
                          <td style={{ padding: "12px 16px" }}>
                            <span style={{ fontSize: 11, background: u.role === "admin" ? "rgba(255,255,255,0.1)" : "var(--bg-3)", padding: "3px 8px", borderRadius: 100, color: "var(--text-2)" }}>{u.role}</span>
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-2)" }}>{u.trialMessagesUsed}</td>
                          <td style={{ padding: "12px 16px", fontSize: 13 }}>
                            {u.hasOwnKey ? <span style={{ color: "var(--success)", fontSize: 12 }}>✓ {u.maskedKey}</span> : <span style={{ color: "var(--text-3)", fontSize: 12 }}>—</span>}
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <span style={{ fontSize: 11, background: u.suspended ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)", color: u.suspended ? "#fca5a5" : "#86efac", padding: "3px 8px", borderRadius: 100 }}>
                              {u.suspended ? "Suspended" : "Active"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-3)" }}>
                            {new Date(u.createdAt).toLocaleDateString()}
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <button
                              onClick={() => toggleSuspend(u.id, u.suspended)}
                              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: `1px solid ${u.suspended ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`, background: u.suspended ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)", color: u.suspended ? "#86efac" : "#fca5a5" }}
                            >
                              {u.suspended ? "Unsuspend" : "Suspend"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {users.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>No users yet.</div>}
                </div>
              </div>
            )}

            {/* Settings */}
            {tab === "settings" && (
              <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {settings.map(s => (
                  <div key={s.key} style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20, display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 6, fontFamily: "var(--font-mono)" }}>{s.key}</div>
                      <input
                        value={settingEdits[s.key] ?? s.value}
                        onChange={e => setSettingEdits(prev => ({ ...prev, [s.key]: e.target.value }))}
                        style={{ fontSize: 13 }}
                      />
                    </div>
                    <button
                      onClick={() => saveSetting(s.key)}
                      disabled={savingSettings || settingEdits[s.key] === s.value}
                      style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: settingEdits[s.key] === s.value ? "var(--bg-3)" : "var(--text)", color: settingEdits[s.key] === s.value ? "var(--text-3)" : "var(--bg)", flexShrink: 0, transition: "all 150ms" }}
                    >
                      Save
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

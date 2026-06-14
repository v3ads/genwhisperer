import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { admin, chat, type AdminUser, type AdminStats, type SettingsMap } from "../lib/api";
import { CURATED_MODELS, availableCuratedModels, type CuratedModel } from "../lib/models";
import { Brand } from "../components/Brand";
import "./App.css";

function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}
function ago(iso: string | null) {
  if (!iso) return "never";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Admin() {
  const nav = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [settings, setSettings] = useState<SettingsMap>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [modelOptions, setModelOptions] = useState<CuratedModel[]>(CURATED_MODELS);

  function loadAll() {
    admin.users().then((r) => setUsers(r.users)).catch(() => {});
    admin.stats().then(setStats).catch(() => {});
    admin.settings().then((r) => setSettings(r.settings)).catch(() => {});
    chat.models()
      .then((r) => {
        const ids = r.models.map((m) => m.id);
        setModelOptions(availableCuratedModels(ids));
      })
      .catch(() => {
        setModelOptions(CURATED_MODELS);
      });
  }
  useEffect(loadAll, []);

  async function updateSetting(key: string, value: string) {
    setSettings((s) => ({ ...s, [key]: value }));
    try {
      await admin.updateSetting(key, value);
      setBanner("Saved.");
      setTimeout(() => setBanner(null), 1800);
    } catch { setBanner("Couldn't save that setting."); }
  }
  async function toggleSuspend(u: AdminUser) {
    await admin.suspendUser(u.id, !u.suspended).catch(() => {});
    loadAll();
  }
  async function del(u: AdminUser) {
    if (!confirm(`Permanently delete ${u.email} and all their data? This cannot be undone.`)) return;
    await admin.deleteUser(u.id).catch(() => {});
    loadAll();
  }

  const cap = Number(settings.trial_message_cap ?? "5");
  const daily = stats?.dailyVolume ?? [];
  const dmax = Math.max(1, ...daily.map((d) => d.count));
  const filtered = users.filter((u) => u.email.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <header className="app-head">
        <Brand />
        <span className="tag-pill s-trial" style={{ marginLeft: 4 }}>Admin</span>
        <div className="sp" />
        <button className="btn btn-ghost btn-sm" onClick={() => nav("/chat")}>Back to chat</button>
      </header>

      <main className="admin-main">
        <h1 className="app-h1">Dashboard</h1>
        <p className="app-sub">Everything in the system at a glance.</p>
        {banner && <div className="banner banner-ok">{banner}</div>}

        <div className="kpis">
          <div className="kpi"><div className="k-lbl"><span className="d" style={{ background: "var(--cyan)" }} />Total users</div><div className="k-val">{stats?.totalUsers ?? "—"}</div></div>
          <div className="kpi"><div className="k-lbl"><span className="d" style={{ background: "var(--teal)" }} />On free trial</div><div className="k-val">{stats?.trialUsers ?? "—"}</div></div>
          <div className="kpi"><div className="k-lbl"><span className="d" style={{ background: "var(--ok)" }} />Own key</div><div className="k-val">{stats?.ownKeyUsers ?? "—"}</div></div>
          <div className="kpi"><div className="k-lbl"><span className="d" style={{ background: "var(--warn)" }} />Total messages</div><div className="k-val">{stats?.totalMessages ?? "—"}</div></div>
        </div>

        <div className="two-col">
          <div className="panel wide">
            <div className="p-head"><h3>Messages · last 30 days</h3></div>
            <div className="chart">
              {daily.length === 0
                ? <div className="app-sub" style={{ margin: 0 }}>No data yet.</div>
                : daily.map((d, i) => (
                    <div key={i} className="bar" style={{ height: `${(d.count / dmax) * 100}%` }} title={`${d.date}: ${d.count}`} />
                  ))}
            </div>
          </div>
          <div className="panel">
            <div className="p-head"><h3>Free trial &amp; model</h3></div>
            <div className="field">
              <label>Trial model <span className="hint">(platform key)</span></label>
              <select
                className="sel"
                value={settings.default_model ?? ""}
                onChange={(e) => updateSetting("default_model", e.target.value)}
              >
                {/* If the currently-saved model is not in the curated list, show it as a fallback option */}
                {settings.default_model && !modelOptions.some((m) => m.id === settings.default_model) && (
                  <option value={settings.default_model}>{settings.default_model} (current)</option>
                )}
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.label} — {m.note}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Free message cap <span className="hint">(per user)</span></label>
              <input className="inp mono" type="number" min={0} value={cap}
                onChange={(e) => updateSetting("trial_message_cap", e.target.value)} />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="p-head">
            <h3>Users</h3>
            <div className="sp" />
            <input className="inp" style={{ width: 200, padding: "8px 12px" }} placeholder="Search email…"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {filtered.length === 0 ? (
            <div className="app-sub" style={{ margin: 0 }}>No users match.</div>
          ) : filtered.map((u) => (
            <div className="urow" key={u.id}>
              <div className="uav">{initials(u.email)}</div>
              <div className="ui">
                <b>{u.email}{u.role === "admin" && " ·★"}</b>
                <div className="meta">
                  {u.suspended
                    ? <span className="tag-pill s-susp">Suspended</span>
                    : u.hasOwnKey
                      ? <span className="tag-pill s-byok">Own key</span>
                      : <span className="tag-pill s-trial">Trial {u.trialMessagesUsed}/{cap}</span>}
                  <small>{u.preferredModel?.split("/").pop() ?? "—"}</small>
                  <small>· {ago(u.lastSignedIn)}</small>
                </div>
              </div>
              <div className="uact">
                <button className="mini-btn" onClick={() => toggleSuspend(u)}>{u.suspended ? "Unsuspend" : "Suspend"}</button>
                <button className="mini-btn danger" onClick={() => del(u)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

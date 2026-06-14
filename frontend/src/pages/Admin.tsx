import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  admin,
  chat,
  type AdminUser,
  type AdminStats,
  type SettingsMap,
  type GetResponseStatus,
} from "../lib/api";
import { CURATED_MODELS, availableCuratedModels, type CuratedModel } from "../lib/models";
import { Brand } from "../components/Brand";
import "./App.css";

type Tab = "overview" | "users" | "email" | "getresponse";

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

// ─── Overview tab ─────────────────────────────────────────────────────────────
function OverviewTab({
  stats,
  settings,
  modelOptions,
  banner,
  onSetting,
}: {
  stats: AdminStats | null;
  settings: SettingsMap;
  modelOptions: CuratedModel[];
  banner: string | null;
  onSetting: (k: string, v: string) => void;
}) {
  const daily = stats?.dailyVolume ?? [];
  const dmax = Math.max(1, ...daily.map((d) => d.count));
  const cap = Number(settings.trial_message_cap ?? "5");

  return (
    <>
      {banner && <div className="banner banner-ok">{banner}</div>}
      <div className="kpis">
        <div className="kpi">
          <div className="k-lbl"><span className="d" style={{ background: "var(--cyan)" }} />Total users</div>
          <div className="k-val">{stats?.totalUsers ?? "—"}</div>
        </div>
        <div className="kpi">
          <div className="k-lbl"><span className="d" style={{ background: "var(--teal)" }} />On free trial</div>
          <div className="k-val">{stats?.trialUsers ?? "—"}</div>
        </div>
        <div className="kpi">
          <div className="k-lbl"><span className="d" style={{ background: "var(--ok)" }} />Own key</div>
          <div className="k-val">{stats?.ownKeyUsers ?? "—"}</div>
        </div>
        <div className="kpi">
          <div className="k-lbl"><span className="d" style={{ background: "var(--warn)" }} />Total messages</div>
          <div className="k-val">{stats?.totalMessages ?? "—"}</div>
        </div>
        <div className="kpi">
          <div className="k-lbl"><span className="d" style={{ background: "var(--text-dim)" }} />Total tokens</div>
          <div className="k-val">{stats ? (stats.totalTokens / 1000).toFixed(1) + "k" : "—"}</div>
        </div>
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
          <div className="p-head"><h3>Trial &amp; model settings</h3></div>
          <div className="field">
            <label>Trial model <span className="hint">(platform key)</span></label>
            <select
              className="sel"
              value={settings.default_model ?? ""}
              onChange={(e) => onSetting("default_model", e.target.value)}
            >
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
            <input
              className="inp mono"
              type="number"
              min={0}
              value={cap}
              onChange={(e) => onSetting("trial_message_cap", e.target.value)}
            />
          </div>
        </div>
      </div>

      {(stats?.modelUsage?.length ?? 0) > 0 && (
        <div className="panel">
          <div className="p-head"><h3>Model usage breakdown</h3></div>
          <table className="data-table">
            <thead><tr><th>Model</th><th>Messages</th></tr></thead>
            <tbody>
              {stats!.modelUsage!.map((m) => (
                <tr key={m.model}>
                  <td className="mono" style={{ fontSize: 12 }}>{m.model}</td>
                  <td>{m.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ─── Users tab ────────────────────────────────────────────────────────────────
function UsersTab({
  users,
  settings,
  banner,
  onToggleSuspend,
  onSetRole,
  onDelete,
}: {
  users: AdminUser[];
  settings: SettingsMap;
  banner: string | null;
  onToggleSuspend: (u: AdminUser) => void;
  onSetRole: (u: AdminUser, role: "user" | "admin") => void;
  onDelete: (u: AdminUser) => void;
}) {
  const [q, setQ] = useState("");
  const cap = Number(settings.trial_message_cap ?? "5");
  const filtered = users.filter((u) => u.email.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      {banner && <div className="banner banner-ok">{banner}</div>}
      <div className="panel">
        <div className="p-head">
          <h3>Users ({users.length})</h3>
          <div className="sp" />
          <input
            className="inp"
            style={{ width: 220, padding: "8px 12px" }}
            placeholder="Search email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {filtered.length === 0 ? (
          <div className="app-sub" style={{ margin: 0 }}>No users match.</div>
        ) : filtered.map((u) => (
          <div className="urow" key={u.id}>
            <div className="uav">{initials(u.email)}</div>
            <div className="ui">
              <b>{u.email}</b>
              {u.role === "admin" && (
                <span className="tag-pill s-admin" style={{ marginLeft: 6 }}>Admin</span>
              )}
              <div className="meta">
                {u.suspended
                  ? <span className="tag-pill s-susp">Suspended</span>
                  : u.hasOwnKey
                    ? <span className="tag-pill s-byok">Own key</span>
                    : <span className="tag-pill s-trial">Trial {u.trialMessagesUsed}/{cap}</span>}
                <small>{u.preferredModel?.split("/").pop() ?? "—"}</small>
                <small>· Joined {ago(u.createdAt)}</small>
                <small>· Last seen {ago(u.lastSignedIn)}</small>
              </div>
            </div>
            <div className="uact">
              {u.role !== "admin" && (
                <button className="mini-btn" onClick={() => onSetRole(u, "admin")} title="Promote to admin">
                  ★ Admin
                </button>
              )}
              {u.role === "admin" && (
                <button className="mini-btn" onClick={() => onSetRole(u, "user")} title="Demote to user">
                  Demote
                </button>
              )}
              <button className="mini-btn" onClick={() => onToggleSuspend(u)}>
                {u.suspended ? "Unsuspend" : "Suspend"}
              </button>
              <button className="mini-btn danger" onClick={() => onDelete(u)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Email tab ────────────────────────────────────────────────────────────────
const EMAIL_SETTINGS = [
  {
    key: "magic_link_subject",
    label: "Magic link email subject",
    hint: "Subject line for sign-in emails",
    type: "text" as const,
    placeholder: "Your GenWhisperer sign-in link",
  },
  {
    key: "welcome_email_subject",
    label: "Welcome email subject",
    hint: "Subject line for the welcome email sent after first sign-in",
    type: "text" as const,
    placeholder: "Welcome to GenWhisperer",
  },
  {
    key: "sender_name",
    label: "Sender name",
    hint: "Name shown in the From field",
    type: "text" as const,
    placeholder: "GenWhisperer",
  },
  {
    key: "support_email",
    label: "Support email address",
    hint: "Shown in email footers",
    type: "text" as const,
    placeholder: "support@genwhisperer.com",
  },
  {
    key: "magic_link_body_html",
    label: "Magic link email body (HTML)",
    hint: 'Use {{link}} as the placeholder for the sign-in URL',
    type: "textarea" as const,
    placeholder: '<p>Click <a href="{{link}}">here</a> to sign in.</p>',
  },
];

function EmailTab({
  settings,
  banner,
  onSetting,
}: {
  settings: SettingsMap;
  banner: string | null;
  onSetting: (k: string, v: string) => void;
}) {
  return (
    <>
      {banner && <div className="banner banner-ok">{banner}</div>}
      <div className="panel">
        <div className="p-head"><h3>Email settings</h3></div>
        <p className="app-sub" style={{ marginBottom: 20 }}>
          These settings control the transactional emails sent via Brevo. Changes take effect immediately on the next send.
        </p>
        {EMAIL_SETTINGS.map((s) => (
          <div className="field" key={s.key}>
            <label>{s.label} <span className="hint">{s.hint}</span></label>
            {s.type === "textarea" ? (
              <textarea
                className="inp mono"
                rows={6}
                style={{ resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                value={settings[s.key] ?? ""}
                placeholder={s.placeholder}
                onChange={(e) => onSetting(s.key, e.target.value)}
              />
            ) : (
              <input
                className="inp"
                type="text"
                value={settings[s.key] ?? ""}
                placeholder={s.placeholder}
                onChange={(e) => onSetting(s.key, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ─── GetResponse tab ──────────────────────────────────────────────────────────
function GetResponseTab({
  grStatus,
  grLoading,
  settings,
  banner,
  adminEmail,
  onRefresh,
  onTestSubscribe,
  onSetting,
}: {
  grStatus: GetResponseStatus | null;
  grLoading: boolean;
  settings: SettingsMap;
  banner: string | null;
  adminEmail: string;
  onRefresh: () => void;
  onTestSubscribe: () => void;
  onSetting: (k: string, v: string) => void;
}) {
  return (
    <>
      {banner && <div className="banner banner-ok">{banner}</div>}

      {/* Connection status */}
      <div className="panel">
        <div className="p-head">
          <h3>GetResponse connection</h3>
          <div className="sp" />
          <button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={grLoading}>
            {grLoading ? "Checking…" : "Refresh"}
          </button>
        </div>

        {grLoading && (
          <div className="app-sub" style={{ margin: 0 }}>Connecting to GetResponse…</div>
        )}

        {!grLoading && grStatus && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span
                style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: grStatus.connected ? "var(--ok)" : "var(--danger)",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 600, color: grStatus.connected ? "var(--ok)" : "var(--danger)" }}>
                {grStatus.connected ? "Connected" : "Not connected"}
              </span>
              {grStatus.error && (
                <span className="app-sub" style={{ margin: 0, fontSize: 13 }}>— {grStatus.error}</span>
              )}
            </div>

            {grStatus.connected && (
              <div className="gr-info">
                <div className="gr-row">
                  <span className="gr-label">Account</span>
                  <span>{grStatus.accountName ?? "—"} ({grStatus.email ?? "—"})</span>
                </div>
                <div className="gr-row">
                  <span className="gr-label">Active list</span>
                  <span>
                    {grStatus.listName
                      ? <><b>{grStatus.listName}</b> <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>({grStatus.listId})</span></>
                      : <span className="app-sub" style={{ margin: 0 }}>No list configured</span>}
                  </span>
                </div>
                <div className="gr-row">
                  <span className="gr-label">Contacts</span>
                  <span>{grStatus.contactCount ?? 0}</span>
                </div>
                {(grStatus.campaigns?.length ?? 0) > 0 && (
                  <div className="gr-row" style={{ alignItems: "flex-start" }}>
                    <span className="gr-label">All lists</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {grStatus.campaigns!.map((c) => (
                        <span key={c.id} style={{ fontSize: 13 }}>
                          {c.name}{" "}
                          <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>({c.id})</span>
                          {c.id === grStatus.listId && (
                            <span className="tag-pill s-byok" style={{ marginLeft: 6, fontSize: 10 }}>active</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Test subscription */}
      {grStatus?.connected && (
        <div className="panel">
          <div className="p-head"><h3>Test subscription</h3></div>
          <p className="app-sub" style={{ marginBottom: 16 }}>
            Add <b>{adminEmail}</b> to the active list to verify the integration end-to-end.
          </p>
          <button
            className="btn btn-primary"
            style={{ width: "auto", padding: "10px 20px" }}
            onClick={onTestSubscribe}
          >
            Add test contact
          </button>
        </div>
      )}

      {/* GetResponse settings */}
      <div className="panel">
        <div className="p-head"><h3>GetResponse settings</h3></div>
        <div className="field">
          <label>Welcome email subject <span className="hint">(sent via GetResponse autoresponder)</span></label>
          <input
            className="inp"
            type="text"
            value={settings.gr_welcome_subject ?? ""}
            placeholder="Welcome to GenWhisperer"
            onChange={(e) => onSetting("gr_welcome_subject", e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Auto-subscribe new users <span className="hint">(adds every new sign-up to the active list)</span></label>
          <select
            className="sel"
            value={settings.gr_auto_subscribe ?? "true"}
            onChange={(e) => onSetting("gr_auto_subscribe", e.target.value)}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </div>
      </div>
    </>
  );
}

// ─── Main Admin component ─────────────────────────────────────────────────────
export default function Admin() {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [settings, setSettings] = useState<SettingsMap>({});
  const [grStatus, setGrStatus] = useState<GetResponseStatus | null>(null);
  const [grLoading, setGrLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<CuratedModel[]>(CURATED_MODELS);

  function showBanner(msg: string) {
    setBanner(msg);
    setTimeout(() => setBanner(null), 2200);
  }

  function loadAll() {
    admin.users().then((r) => setUsers(r.users)).catch(() => {});
    admin.stats().then(setStats).catch(() => {});
    admin.settings().then((r) => setSettings(r.settings)).catch(() => {});
    chat.models()
      .then((r) => {
        const ids = r.models.map((m) => m.id);
        setModelOptions(availableCuratedModels(ids));
      })
      .catch(() => setModelOptions(CURATED_MODELS));
  }

  function loadGrStatus() {
    setGrLoading(true);
    admin.getResponseStatus()
      .then(setGrStatus)
      .catch(() => setGrStatus({ connected: false, error: "Request failed" }))
      .finally(() => setGrLoading(false));
  }

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (tab === "getresponse" && !grStatus && !grLoading) {
      loadGrStatus();
    }
  }, [tab]);

  async function updateSetting(key: string, value: string) {
    setSettings((s) => ({ ...s, [key]: value }));
    try {
      await admin.updateSetting(key, value);
      showBanner("Saved.");
    } catch {
      showBanner("Couldn't save that setting.");
    }
  }

  async function toggleSuspend(u: AdminUser) {
    await admin.suspendUser(u.id, !u.suspended).catch(() => {});
    loadAll();
  }

  async function setRole(u: AdminUser, role: "user" | "admin") {
    if (!confirm(`${role === "admin" ? "Promote" : "Demote"} ${u.email} to ${role}?`)) return;
    await admin.setRole(u.id, role).catch(() => {});
    loadAll();
    showBanner(`${u.email} is now ${role}.`);
  }

  async function del(u: AdminUser) {
    if (!confirm(`Permanently delete ${u.email} and all their data? This cannot be undone.`)) return;
    await admin.deleteUser(u.id).catch(() => {});
    loadAll();
  }

  async function testSubscribe() {
    try {
      const adminUser = users.find((u) => u.role === "admin");
      const email = adminUser?.email ?? "test@genwhisperer.com";
      const result = await admin.testSubscribe(email);
      showBanner(result.note ? `Already subscribed: ${email}` : `Test contact added: ${email}`);
      loadGrStatus();
    } catch (e: any) {
      showBanner(`Failed: ${e?.message ?? "Unknown error"}`);
    }
  }

  const adminEmail = users.find((u) => u.role === "admin")?.email ?? "admin@genwhisperer.com";

  const TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "users", label: `Users (${users.length})` },
    { id: "email", label: "Email" },
    { id: "getresponse", label: "GetResponse" },
  ];

  return (
    <div>
      <header className="app-head">
        <Brand />
        <span className="tag-pill s-trial" style={{ marginLeft: 4 }}>Admin</span>
        <div className="sp" />
        <button className="btn btn-ghost btn-sm" onClick={() => nav("/chat")}>Back to chat</button>
      </header>

      <main className="admin-main">
        <h1 className="app-h1">Admin Dashboard</h1>
        <p className="app-sub">Full control over GenWhisperer.</p>

        {/* Tab bar */}
        <div className="tab-bar">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab-btn${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <OverviewTab
            stats={stats}
            settings={settings}
            modelOptions={modelOptions}
            banner={banner}
            onSetting={updateSetting}
          />
        )}
        {tab === "users" && (
          <UsersTab
            users={users}
            settings={settings}
            banner={banner}
            onToggleSuspend={toggleSuspend}
            onSetRole={setRole}
            onDelete={del}
          />
        )}
        {tab === "email" && (
          <EmailTab
            settings={settings}
            banner={banner}
            onSetting={updateSetting}
          />
        )}
        {tab === "getresponse" && (
          <GetResponseTab
            grStatus={grStatus}
            grLoading={grLoading}
            settings={settings}
            banner={banner}
            adminEmail={adminEmail}
            onRefresh={loadGrStatus}
            onTestSubscribe={testSubscribe}
            onSetting={updateSetting}
          />
        )}
      </main>
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import { AppNav } from "../components/AppNav";
import {
  admin as adminApi,
  ApiError,
  type AdminUser,
  type AdminProject,
  type AdminConversation,
  type HistoryMessage,
  type UserUsage,
} from "../lib/api";
import { mdToHtml } from "../lib/mdToHtml";
import "./Admin.css";
import "./App.css";

/**
 * Admin dashboard (V2) — owner-only.
 *
 * Master-detail: users list (left) → selected user's projects + conversations
 * (right) → click a conversation to read its full message history in an
 * overlay reader. Suspend/unsuspend + delete controls on the user.
 */
export default function Admin() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [conversations, setConversations] = useState<AdminConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [usage, setUsage] = useState<UserUsage | null>(null);

  // conversation reader overlay state
  const [readerConv, setReaderConv] = useState<{ id: number; title: string } | null>(null);
  const [readerMsgs, setReaderMsgs] = useState<HistoryMessage[]>([]);
  const [readerLoading, setReaderLoading] = useState(false);

  async function loadUsers() {
    try {
      const r = await adminApi.users();
      setUsers(r.users);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load users.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void loadUsers(); }, []);

  const loadDetail = useCallback(async (id: number) => {
    setErr(null);
    try {
      const [p, c, u] = await Promise.all([
        adminApi.userProjects(id),
        adminApi.userConversations(id),
        adminApi.userUsage(id),
      ]);
      setProjects(p.projects);
      setConversations(c.conversations);
      setUsage(u);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load user detail.");
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else { setProjects([]); setConversations([]); setUsage(null); }
  }, [selectedId, loadDetail]);

  async function openConversation(c: AdminConversation) {
    setReaderConv({ id: c.id, title: c.title });
    setReaderMsgs([]);
    setReaderLoading(true);
    try {
      const d = await adminApi.conversation(c.id);
      setReaderMsgs(d.messages);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load conversation.");
    } finally { setReaderLoading(false); }
  }

  async function suspend(u: AdminUser) {
    if (!confirm(`${u.suspended ? "Unsuspend" : "Suspend"} ${u.email}?`)) return;
    setErr(null);
    try {
      await adminApi.suspend(u.id, !u.suspended);
      void loadUsers();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not update user.");
    }
  }

  async function remove(u: AdminUser) {
    if (!confirm(`Delete ${u.email} and ALL their projects, conversations, and history? This cannot be undone.`)) return;
    setErr(null);
    try {
      await adminApi.deleteUser(u.id);
      if (selectedId === u.id) setSelectedId(null);
      void loadUsers();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete user.");
    }
  }

  function fmt(iso: string): string {
    try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch { return iso; }
  }

  const selected = users.find((u) => u.id === selectedId) ?? null;

  return (
    <div className="app-wrap">
      <div className="app-glow" />
      <AppNav />
      <div className="admin-wrap">
        <div className="admin-body">
          {/* ─── users list ─── */}
          <div className="admin-users">
            <div className="admin-users-head">
              <h2>Users</h2>
              <p className="sub">{users.length} total</p>
            </div>
            <div className="admin-users-list">
              {loading ? (
                <div className="ad-empty">Loading…</div>
              ) : users.length === 0 ? (
                <div className="ad-empty">No users.</div>
              ) : (
                users.map((u) => (
                  <div
                    key={u.id}
                    className={`au-row ${selectedId === u.id ? "active" : ""}`}
                    onClick={() => setSelectedId(u.id)}
                  >
                    <div className="au-meta">
                      <div className="au-email">{u.email}</div>
                      <div className="au-sub">{u.projectCount} proj · {u.conversationCount} conv</div>
                    </div>
                    {u.role === "admin" && <span className="au-pill admin">admin</span>}
                    {u.suspended && <span className="au-pill banned">banned</span>}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ─── detail ─── */}
          <div className="admin-detail">
            {err && <div className="banner banner-err" style={{ margin: 16 }}>{err}</div>}
            {!selected ? (
              <div className="admin-detail-body">
                <div className="ad-empty" style={{ textAlign: "center", paddingTop: 60 }}>
                  Select a user to view their projects and conversation history.
                </div>
              </div>
            ) : (
              <>
                <div className="admin-detail-head">
                  <div>
                    <div className="au-email">{selected.email}</div>
                    <div className="au-sub" style={{ fontSize: 12, color: "var(--text-faint)", fontFamily: "'JetBrains Mono',monospace", marginTop: 3 }}>
                      id {selected.id} · joined {fmt(selected.createdAt)} · last seen {selected.lastSignedIn ? fmt(selected.lastSignedIn) : "never"}
                    </div>
                  </div>
                  <div className="sp" />
                  {selected.role !== "admin" && (
                    <div className="acts">
                      <button className={selected.suspended ? "unban" : ""} onClick={() => suspend(selected)}>
                        {selected.suspended ? "Unsuspend" : "Suspend"}
                      </button>
                      <button className="danger" onClick={() => remove(selected)}>Delete</button>
                    </div>
                  )}
                </div>
                <div className="admin-detail-body">
                  <div className="ad-section">
                    <h3>Genesis projects ({projects.length})</h3>
                    {projects.length === 0 ? (
                      <div className="ad-empty">No projects.</div>
                    ) : (
                      projects.map((p) => (
                        <div className="list-row" key={p.id}>
                          <div className="meta">
                            <div className="t">{p.name}</div>
                            <div className="s">project {p.genesisProjectId ?? "?"} · token {p.tokenMasked}</div>
                            <div className="s" style={{ marginTop: 4 }}>{p.mcpUrl}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="ad-section">
                    <h3>Conversation history ({conversations.length})</h3>
                    {conversations.length === 0 ? (
                      <div className="ad-empty">No conversations.</div>
                    ) : (
                      conversations.map((c) => (
                        <div className="ad-conv" key={c.id} onClick={() => openConversation(c)}>
                          <div className="t">{c.title}</div>
                          <div className="s">{c.model} · {fmt(c.updatedAt)}</div>
                        </div>
                      ))
                    )}
                  </div>
                  {/* Usage / cost analytics (#2) */}
                  <div className="ad-section">
                    <h3>Usage &amp; cost ({usage?.days ?? 30}d)</h3>
                    {usage ? (
                      <>
                        <div className="list-row" style={{ marginBottom: 14 }}>
                          <div className="meta">
                            <div className="t">${usage.totalCostUsd.toFixed(4)} total · {usage.totalTurns} turns</div>
                            <div className="s">since {fmt(usage.since)}</div>
                          </div>
                        </div>
                        {usage.byModel.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <div className="s" style={{ marginBottom: 6 }}>By model</div>
                            {usage.byModel.map((m) => (
                              <div className="list-row" key={m.model} style={{ padding: "10px 14px", marginBottom: 6 }}>
                                <div className="meta">
                                  <div className="t mono" style={{ fontSize: 13.5 }}>{m.model}</div>
                                  <div className="s">{m.turns} turns · ${m.costUsd.toFixed(4)}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {usage.recent.length > 0 && (
                          <div style={{ marginTop: 10 }}>
                            <div className="s" style={{ marginBottom: 6 }}>Recent turns</div>
                            {usage.recent.slice(0, 8).map((r) => (
                              <div className="list-row" key={r.id} style={{ padding: "10px 14px", marginBottom: 6 }}>
                                <div className="meta">
                                  <div className="t mono" style={{ fontSize: 13 }}>{r.role} · {r.model}</div>
                                  <div className="s">${r.costUsd.toFixed(4)} · {fmt(r.createdAt)}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="ad-empty">No usage in this window.</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── conversation reader overlay ─── */}
      {readerConv && (
        <div className="admin-reader" onClick={(e) => { if (e.target === e.currentTarget) setReaderConv(null); }}>
          <div className="admin-reader-card">
            <div className="admin-reader-head">
              <div className="t">{readerConv.title}</div>
              <button className="close" onClick={() => setReaderConv(null)}>Close</button>
            </div>
            <div className="admin-reader-body">
              {readerLoading ? (
                <div className="ad-empty">Loading messages…</div>
              ) : readerMsgs.length === 0 ? (
                <div className="ad-empty">No messages.</div>
              ) : (
                readerMsgs.map((m) => (
                  <div key={m.id} className={`ar-msg ${m.role === "user" ? "user" : m.role === "assistant" ? "assistant" : "tool"}`}>
                    <div className="role">{m.role}</div>
                    <div
                      className="bubble"
                      dangerouslySetInnerHTML={{ __html: m.role === "tool" ? escapeHtml(m.content) : mdToHtml(m.content) }}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

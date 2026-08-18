import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppNav } from "../components/AppNav";
import { agent as agentApi, ApiError, type ConversationSummary } from "../lib/api";
import "./App.css";

/**
 * Conversations page (V2) — DB-backed history.
 *
 * Lists the user's past agent sessions (title, project, model, last-updated),
 * with Resume (loads history into the Builder) and Delete actions.
 */
export default function Conversations() {
  const nav = useNavigate();
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const r = await agentApi.conversations();
      setList(r.conversations);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load conversations.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function del(id: number) {
    if (!confirm("Delete this conversation and all its messages?")) return;
    setErr(null);
    try {
      await agentApi.deleteConversation(id);
      setList((l) => l.filter((c) => c.id !== id));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete conversation.");
    }
  }

  function resume(id: number, projectId: number) {
    nav(`/builder?project=${projectId}&conversation=${id}`);
  }

  function fmt(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  }

  return (
    <div className="app-wrap">
      <div className="app-glow" />
      <AppNav />
      <main className="app-main">
        {err && <div className="banner banner-err">{err}</div>}
        <div className="card">
          <h2>Conversation history</h2>
          <p className="sub">Every agent session is saved. Resume one to continue right where you left off.</p>
          {loading ? (
            <p style={{ color: "var(--text-faint)", fontSize: 14 }}>Loading…</p>
          ) : list.length === 0 ? (
            <p style={{ color: "var(--text-faint)", fontSize: 14 }}>
              No conversations yet. Start one in the{" "}
              <a className="link-inline" onClick={() => nav("/builder")}>Builder</a>.
            </p>
          ) : (
            list.map((c) => (
              <div className="list-row" key={c.id}>
                <div className="meta">
                  <div className="t">{c.title}</div>
                  <div className="s">project {c.genesisProjectId} · {c.model} · updated {fmt(c.updatedAt)}</div>
                </div>
                <div className="actions">
                  <button onClick={() => resume(c.id, c.genesisProjectId)}>Resume</button>
                  <button className="danger" onClick={() => del(c.id)}>Delete</button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

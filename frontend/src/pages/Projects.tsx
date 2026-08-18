import { useEffect, useState } from "react";
import { AppNav } from "../components/AppNav";
import { projects as projectsApi, ApiError, type Project } from "../lib/api";
import "./App.css";

/**
 * Projects page (V2) — the tenant's Genesis projects.
 *
 * Each project stores a name, the MCP Server URL, and a one-time token
 * (validated via the MCP handshake before saving, encrypted at rest). The
 * list shows masked tokens. Linked to /guide/genesis-project.
 */
export default function Projects() {
  const [list, setList] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);

  // add-form state
  const [name, setName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    try {
      const r = await projectsApi.list();
      setList(r.projects);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load projects.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function add() {
    if (!name.trim() || !mcpUrl.trim() || !token.trim()) {
      setErr("Name, MCP URL, and token are all required."); return;
    }
    setBusy(true); setErr(null); setOk(null);
    try {
      await projectsApi.create(name.trim(), mcpUrl.trim(), token.trim());
      setName(""); setMcpUrl(""); setToken(""); setShowAdd(false);
      setOk("Project connected. The MCP handshake passed.");
      void load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setErr(e.message);
        setLimitHit(true);
      } else {
        setErr(e instanceof ApiError ? e.message : "Could not add project.");
      }
    } finally { setBusy(false); }
  }

  async function remove(id: number) {
    if (!confirm("Remove this project? Its conversations will also be deleted.")) return;
    setErr(null); setOk(null);
    try {
      await projectsApi.remove(id);
      setOk("Project removed.");
      void load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not remove project.");
    }
  }

  async function refreshToken(id: number) {
    const t = prompt("Paste a fresh one-time token from Genesis > Integrations > Claude Code:\n\n(paste as plain text, not a screenshot)");
    if (!t || !t.trim()) return;
    setErr(null); setOk(null);
    try {
      await projectsApi.update(id, { token: t.trim() });
      setOk("Token refreshed and validated.");
      void load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not refresh token.");
    }
  }

  return (
    <div className="app-wrap">
      <div className="app-glow" />
      <AppNav />
      <main className="app-main">
        {err && (
          <div className="banner banner-err">
            {err}
            {limitHit && (
              <> &nbsp;<a className="link-inline" href="/billing">Upgrade your plan →</a></>
            )}
          </div>
        )}
        {ok && <div className="banner banner-ok">{ok}</div>}

        <div className="card">
          <h2>Genesis projects</h2>
          <p className="sub">
            Connect the Genesis projects you want the agent to build for you. Each project has its
            own MCP URL + one-time token.{" "}
            <a className="link-inline" href="/guide/genesis-project" target="_blank" rel="noopener noreferrer">How do I connect one?</a>
          </p>

          {!showAdd ? (
            <button className="btn btn-primary" onClick={() => { setShowAdd(true); setErr(null); setLimitHit(false); }} style={{ width: "auto" }}>
              + Add project
            </button>
          ) : (
            <>
              <div className="fld">
                <label htmlFor="pname">Name</label>
                <input id="pname" className="inp" placeholder="Main marketing site"
                  value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="fld">
                <label htmlFor="purl">MCP Server URL</label>
                <input id="purl" className="inp mono" style={{ fontFamily: "'JetBrains Mono',monospace" }}
                  placeholder="https://genesis.estage.com/api/agent/75572/mcp"
                  value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} />
                <div className="hint">From Genesis → Account → Integrations → Claude Code.</div>
              </div>
              <div className="fld">
                <label htmlFor="ptok">One-time token</label>
                <input id="ptok" className="inp" type="password" placeholder="paste as plain text"
                  value={token} autoComplete="off" onChange={(e) => setToken(e.target.value)} />
                <div className="hint">Generate token → copy immediately (shown once). Paste as plain text, not a screenshot.</div>
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" onClick={add} disabled={busy}>
                  {busy ? "Validating connection…" : "Connect project"}
                </button>
                <button className="btn btn-ghost" onClick={() => { setShowAdd(false); setErr(null); }} disabled={busy}>Cancel</button>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>Your projects</h2>
          {loading ? (
            <p style={{ color: "var(--text-faint)", fontSize: 14 }}>Loading…</p>
          ) : list.length === 0 ? (
            <p style={{ color: "var(--text-faint)", fontSize: 14 }}>No projects yet. Add one above.</p>
          ) : (
            list.map((p) => (
              <div className="list-row" key={p.id}>
                <div className="meta">
                  <div className="t">{p.name}</div>
                  <div className="s">project {p.genesisProjectId ?? "?"} · token {p.tokenMasked}</div>
                  <div className="s" style={{ marginTop: 4 }}>{p.mcpUrl}</div>
                </div>
                <div className="actions">
                  <button onClick={() => refreshToken(p.id)}>Refresh token</button>
                  <button className="danger" onClick={() => remove(p.id)}>Remove</button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

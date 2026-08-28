import { useEffect, useState } from "react";
import { AppNav } from "../components/AppNav";
import { PricingBlock } from "../components/PricingBlock";
import { projects as projectsApi, ApiError, type Project, type Tier } from "../lib/api";
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
  // The tier the 402 limit response reported (drives which plan card reads
  // "Current plan" inside the upgrade modal). Kept separately from
  // `showUpgrade` so re-opening the modal after closing it doesn't need a
  // fresh 402 round-trip.
  const [limitTier, setLimitTier] = useState<Tier | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

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
        // Project-limit gate. Show the upgrade modal with the actual plan
        // options rather than just a text link — the server response tells us
        // which tier the user is currently on so PricingBlock can mark it.
        const payload = (e.payload ?? {}) as { tier?: Tier };
        setErr(e.message);
        setLimitTier(payload.tier ?? "trial");
        setShowUpgrade(true);
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
            {limitTier && !showUpgrade && (
              <> &nbsp;<button className="link-inline link-btn" onClick={() => setShowUpgrade(true)}>See upgrade options →</button></>
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

          {!loading && list.length === 0 && (
            <p className="sub" style={{ marginBottom: 16 }}>
              No projects yet.{" "}
              <a className="link-inline" href="https://genesis.estage.com" target="_blank" rel="noopener noreferrer">
                Create a new blank project in Genesis
              </a>
              , then connect it here.
            </p>
          )}

          {!showAdd ? (
            <button className="btn btn-primary" onClick={() => { setShowAdd(true); setErr(null); setLimitTier(null); setShowUpgrade(false); }} style={{ width: "auto" }}>
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

      {/* ── Upgrade modal: shown when the project-limit gate (402) fires ──── */}
      {showUpgrade && limitTier && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setShowUpgrade(false)}>
          <div className="modal-panel modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>You can upgrade to a higher tier</h2>
              <button className="modal-x" onClick={() => setShowUpgrade(false)} aria-label="Close">×</button>
            </div>
            <p className="sub" style={{ marginBottom: 20 }}>
              Your current plan's project limit is reached. Pick a plan below to add more Genesis
              projects — you can also manage this any time from Billing.
            </p>
            <PricingBlock currentTier={limitTier} compact />
          </div>
        </div>
      )}
    </div>
  );
}

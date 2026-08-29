import { useEffect, useState, useRef } from "react";
import { AppNav } from "../components/AppNav";
import { PricingBlock } from "../components/PricingBlock";
import {
  github as githubApi,
  projects as projectsApi,
  billing as billingApi,
  ApiError,
  type GithubRepo,
  type Project,
  type Tier,
  type SubscriptionState,
} from "../lib/api";
import { streamImport, streamExecute } from "../lib/importStream";
import "./Import.css";

/** The plan shape returned by Stage A (kept loose — the server is the source of truth). */
interface ImportPlan {
  repo: { owner: string; name: string; branch: string };
  summary: string;
  routes: Array<{ source: string; genesisPage: string; isHome: boolean }>;
  files: Array<{ genesisPath: string; fromRepoPath: string; translated: boolean; note: string }>;
  assets: Array<{ repoPath: string; genesisMediaName: string; rewriteIn: string[] }>;
  dataCatalogs: Array<{ genesisPath: string; fromRepoPath: string; note: string }>;
  backend: {
    detected: boolean;
    summary: string;
    options: Array<{
      key: "reuse-supabase" | "dedicated-cloud" | "skip";
      label: string;
      agentDoes: string;
      userDoes: string;
      recommendedWhen: string;
    }>;
  };
  outOfScope: Array<{ description: string; reason: string }>;
  userNote: string;
  error?: string;
}

/** One step in the import flow. */
type Step = "project" | "repo" | "review" | "running" | "executing" | "done";

export default function Import() {
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<SubscriptionState | null>(null);
  const [ghConnected, setGhConnected] = useState(false);
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [pat, setPat] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);
  const [backendOption, setBackendOption] = useState<"reuse-supabase" | "dedicated-cloud" | "skip">("skip");
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [summary, setSummary] = useState<{ succeeded: string[]; skipped: string[]; failed: Array<{ label: string; error: string }> } | null>(null);
  const [pendingGate, setPendingGate] = useState<{ gateId: string; tool: string } | null>(null);
  const [branch, setBranch] = useState("main");
  const [step, setStep] = useState<Step>("project");
  const [status, setStatus] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Pro gate: load subscription; non-pro users see PricingBlock.
  useEffect(() => {
    (async () => {
      try {
        const s = await billingApi.subscription();
        setSub(s);
      } catch {
        setSub(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load GitHub connection status + projects list once (pro) past the gate.
  useEffect(() => {
    if (!sub || sub.tier !== "pro") return;
    (async () => {
      try {
        const g = await githubApi.status();
        setGhConnected(g.connected);
        setGhLogin(g.login ?? null);
      } catch { /* ignore — surfaced in connect step */ }
      try {
        const p = await projectsApi.list();
        setProjects(p.projects);
      } catch { /* ignore */ }
    })();
  }, [sub]);

  const isPro = sub?.tier === "pro";

  async function connectGithub() {
    if (!pat.trim()) {
      setErr("Paste a GitHub personal access token first.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const r = await githubApi.connect(pat.trim());
      setGhConnected(true);
      setGhLogin(r.login);
      setPat("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not connect GitHub.");
    } finally { setBusy(false); }
  }

  async function loadRepos() {
    setBusy(true); setErr(null);
    try {
      const r = await githubApi.repos();
      setRepos(r.repos);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load your repos.");
    } finally { setBusy(false); }
  }

  function startImport() {
    if (!selectedProject || !selectedRepo) return;
    setStep("running");
    setStatus("Starting…");
    setPlan(null);
    setErr(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    void streamImport(
      {
        genesisProjectId: selectedProject,
        repoOwner: selectedRepo.owner,
        repoName: selectedRepo.name,
        branch: branch || selectedRepo.defaultBranch || "main",
      },
      {
        onStatus: (t) => setStatus(t),
        onPlan: (p) => setPlan(p as ImportPlan),
        onError: (m) => { setErr(m); setStep("review"); },
        onDone: () => { setBusy(false); setStep("review"); },
      },
      ctrl.signal
    );
  }

  function startExecute() {
    if (!selectedProject || !plan) return;
    setStep("executing");
    setStatus("Executing the plan on Genesis…");
    setErr(null);
    setSummary(null);
    setProgress(null);
    setPendingGate(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    void streamExecute(
      {
        genesisProjectId: selectedProject,
        plan,
        backendOption,
      },
      {
        onStatus: (t) => setStatus(t),
        onProgress: (d, tot, label) => setProgress({ done: d, total: tot, label }),
        onToolApprovalRequest: (gateId, tool) => setPendingGate({ gateId, tool }),
        onToolApprovalResolved: (gateId, approved) => {
          setPendingGate(null);
          void githubApi.approveGate(gateId, approved).catch(() => { /* surfaced via status */ });
        },
        onSummary: (s, sk, f) => { setSummary({ succeeded: s, skipped: sk, failed: f }); },
        onError: (m) => { setErr(m); setStep("review"); },
        onDone: () => { setBusy(false); setStep("done"); },
      },
      ctrl.signal
    );
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStep("review");
    setStatus(null);
  }

  if (loading) {
    return (
      <div className="app-wrap"><div className="app-glow" /><AppNav />
        <main className="app-main"><div className="card"><p style={{ color: "var(--text-faint)" }}>Loading…</p></div></main>
      </div>
    );
  }

  // Non-pro gate: show upgrade prompt instead of the import flow.
  if (!isPro) {
    return (
      <div className="app-wrap"><div className="app-glow" /><AppNav />
        <main className="app-main">
          <div className="card">
            <h2>GitHub → Genesis import is a Pro feature</h2>
            <p className="sub">Recreate a GitHub repo (like a Lovable export) on an eStage Genesis project. Upgrade to Pro to use it.</p>
            <PricingBlock currentTier={(sub?.tier ?? "trial") as Tier} compact />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-wrap">
      <div className="app-glow" />
      <AppNav />
      <main className="app-main">
        {err && <div className="banner banner-err">{err}</div>}
        {status && step === "running" && (
          <div className="banner banner-info">
            {status}{" "}
            <button className="link-inline link-btn" onClick={cancel}>Cancel</button>
          </div>
        )}

        <div className="card">
          <h2>Import a GitHub repo to Genesis</h2>
          <p className="sub">
            Recreate a GitHub repository (typically a Lovable export) on a connected Genesis project.
            {" "}<a className="link-inline" href="/guide/genesis-project" target="_blank" rel="noopener noreferrer">Need a blank Genesis project first?</a>
          </p>

          {/* Step 1: GitHub connection */}
          {!ghConnected ? (
            <>
              <h3>1. Connect your GitHub</h3>
              <p className="sub">Paste a personal access token (PAT) with <code>repo</code> scope. We encrypt it at rest and never send it to your browser.</p>
              <div className="fld">
                <label htmlFor="pat">GitHub PAT</label>
                <input id="pat" className="inp" type="password" placeholder="ghp_… or github_pat_…"
                  value={pat} autoComplete="off" onChange={(e) => setPat(e.target.value)} />
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" onClick={connectGithub} disabled={busy}>
                  {busy ? "Connecting…" : "Connect GitHub"}
                </button>
              </div>
            </>
          ) : (
            <p className="sub">✓ GitHub connected as <b>{ghLogin}</b>. {" "}
              <button className="link-inline link-btn" onClick={() => { setGhConnected(false); setGhLogin(null); }}>Disconnect</button>
            </p>
          )}
        </div>

        {/* Step 2: pick a connected Genesis project to import into */}
        {ghConnected && (
          <div className="card">
            <h3>2. Pick the Genesis project to import into</h3>
            {projects.length === 0 ? (
              <p className="sub">
                No Genesis projects connected.{" "}
                <a className="link-inline" href="/projects">Connect one first</a>
                {" "}(create a new <b>blank</b> project in Genesis, then connect it here).
              </p>
            ) : (
              <>
                <p className="sub">A blank project (0 pages) is the ideal import target. Importing into a project with existing pages layers the import on top.</p>
                <select className="inp" value={selectedProject ?? ""} onChange={(e) => setSelectedProject(Number(e.target.value))}>
                  <option value="" disabled>Select a Genesis project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} (Genesis {p.genesisProjectId ?? "?"})</option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}

        {/* Step 3: pick a repo + branch */}
        {ghConnected && selectedProject && (
          <div className="card">
            <h3>3. Pick a repo to import</h3>
            {repos.length === 0 ? (
              <div className="btn-row">
                <button className="btn btn-primary" onClick={loadRepos} disabled={busy}>
                  {busy ? "Loading…" : "Load my repos"}
                </button>
              </div>
            ) : (
              <>
                <select className="inp" value={selectedRepo?.id ?? ""} onChange={(e) => {
                  const r = repos.find((x) => x.id === Number(e.target.value)) ?? null;
                  setSelectedRepo(r);
                  setBranch(r?.defaultBranch ?? "main");
                }}>
                  <option value="" disabled>Select a repo…</option>
                  {repos.map((r) => (
                    <option key={r.id} value={r.id}>{r.fullName}{r.private ? " (private)" : ""}</option>
                  ))}
                </select>
                <div className="fld" style={{ marginTop: 10 }}>
                  <label htmlFor="branch">Branch</label>
                  <input id="branch" className="inp" value={branch} onChange={(e) => setBranch(e.target.value)} />
                </div>
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={startImport} disabled={busy || !selectedRepo}>
                    {busy ? "Working…" : "Plan the import"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 4: review the plan (Stage A output) */}
        {step === "review" && plan && (
          <div className="card">
            <h3>4. Review the translation plan</h3>
            {plan.error ? (
              <div className="banner banner-err">The plan didn't come back cleanly: {plan.error}. You can try again.</div>
            ) : (
              <>
                <p className="sub">{plan.summary}</p>
                {plan.userNote && <p className="sub">{plan.userNote}</p>}

                <h4>Pages ({plan.routes.length})</h4>
                <ul className="plan-list">
                  {plan.routes.map((r, i) => (
                    <li key={i}><code>{r.source}</code> → Genesis page <code>{r.genesisPage}</code>{r.isHome ? " (home)" : ""}</li>
                  ))}
                </ul>

                <h4>Files ({plan.files.length})</h4>
                <ul className="plan-list">
                  {plan.files.map((f, i) => (
                    <li key={i}><code>{f.genesisPath}</code> {f.translated ? "(translated)" : "(copied)"} — {f.note}</li>
                  ))}
                </ul>

                {plan.assets.length > 0 && (
                  <>
                    <h4>Media assets ({plan.assets.length})</h4>
                    <ul className="plan-list">
                      {plan.assets.map((a, i) => (
                        <li key={i}><code>{a.repoPath}</code> → Genesis media <code>{a.genesisMediaName}</code></li>
                      ))}
                    </ul>
                  </>
                )}

                {plan.dataCatalogs.length > 0 && (
                  <>
                    <h4>Data catalogs ({plan.dataCatalogs.length})</h4>
                    <ul className="plan-list">
                      {plan.dataCatalogs.map((d, i) => (
                        <li key={i}><code>{d.genesisPath}</code> — {d.note}</li>
                      ))}
                    </ul>
                  </>
                )}

                {plan.backend.detected && (
                  <>
                    <h4>Backend — choose an option</h4>
                    <p className="sub">{plan.backend.summary}</p>
                    <div className="backend-options">
                      {plan.backend.options.map((o) => (
                        <label key={o.key} className={`backend-option ${backendOption === o.key ? "selected" : ""}`}>
                          <input
                            type="radio"
                            name="backend-option"
                            value={o.key}
                            checked={backendOption === o.key}
                            onChange={() => setBackendOption(o.key)}
                          />
                          <div className="plan-option-label"><b>{o.label}</b></div>
                          <div className="sub">GenWhisperer will: {o.agentDoes}</div>
                          <div className="sub">You do first: {o.userDoes}</div>
                          <div className="sub">Recommended when: {o.recommendedWhen}</div>
                        </label>
                      ))}
                    </div>
                  </>
                )}

                {plan.outOfScope.length > 0 && (
                  <>
                    <h4>Out of scope</h4>
                    <ul className="plan-list">
                      {plan.outOfScope.map((o, i) => (
                        <li key={i}>{o.description} — <span className="sub">{o.reason}</span></li>
                      ))}
                    </ul>
                  </>
                )}

                <div className="btn-row">
                  <button className="btn btn-primary" onClick={startExecute} disabled={busy}>
                    {busy ? "Working…" : "Execute on Genesis"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 5: executing (Stage B) */}
        {step === "executing" && (
          <div className="card">
            <h3>5. Recreating your site on Genesis</h3>
            {status && <div className="banner banner-info">{status}</div>}
            {progress && (
              <div className="progress-wrap">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                  />
                </div>
                <div className="sub">
                  {progress.done}/{progress.total} — {progress.label}
                </div>
              </div>
            )}
            {pendingGate && (
              <div className="banner banner-warn">
                <b>Approval needed:</b> {pendingGate.tool === "genesis_publish" ? "Publish your site to the live CDN" : pendingGate.tool === "genesis_cloud_migrate" ? "Migrate the backend schema to Dedicated Cloud" : pendingGate.tool}
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      const g = pendingGate;
                      setPendingGate(null);
                      void githubApi.approveGate(g.gateId, true).catch(() => setPendingGate(g));
                    }}
                  >
                    Approve
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      const g = pendingGate;
                      setPendingGate(null);
                      void githubApi.approveGate(g.gateId, false).catch(() => setPendingGate(g));
                    }}
                  >
                    Deny
                  </button>
                </div>
              </div>
            )}
            {busy && !pendingGate && (
              <div className="btn-row">
                <button className="btn btn-ghost" onClick={cancel}>Cancel</button>
              </div>
            )}
          </div>
        )}

        {/* Done: summary */}
        {step === "done" && summary && (
          <div className="card">
            <h3>Import complete</h3>
            {summary.failed.length === 0 ? (
              <div className="banner banner-ok">
                Done — {summary.succeeded.length} step(s) succeeded
                {summary.skipped.length > 0 ? `, ${summary.skipped.length} skipped` : ""}.
              </div>
            ) : (
              <div className="banner banner-warn">
                Partial: {summary.succeeded.length} succeeded, {summary.skipped.length} skipped, {summary.failed.length} failed.
              </div>
            )}
            {summary.succeeded.length > 0 && (
              <>
                <h4>Succeeded</h4>
                <ul className="plan-list">
                  {summary.succeeded.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </>
            )}
            {summary.skipped.length > 0 && (
              <>
                <h4>Skipped</h4>
                <ul className="plan-list">
                  {summary.skipped.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </>
            )}
            {summary.failed.length > 0 && (
              <>
                <h4>Failed</h4>
                <ul className="plan-list">
                  {summary.failed.map((f, i) => <li key={i}>{f.label} — <span className="sub">{f.error}</span></li>)}
                </ul>
              </>
            )}
            <div className="btn-row">
              <a className="btn btn-primary" href="/builder">Open in Builder</a>
              <button className="btn btn-ghost" onClick={() => { setStep("project"); setPlan(null); setSummary(null); }}>
                Import another repo
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

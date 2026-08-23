import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { AppNav } from "../components/AppNav";
import {
  profile as profileApi,
  projects as projectsApi,
  agent as agentApi,
  billing as billingApi,
  ApiError,
  type Project,
  type OrModel,
  type KbSource,
  type SubscriptionState,
  type PagesCountResult,
} from "../lib/api";
import { streamAgent } from "../lib/agentStream";
import { mdToHtml } from "../lib/mdToHtml";
import "./Builder.css";

/** One rendered chat row. */
interface Row {
  id: string;
  kind: "user" | "narration" | "assistant" | "error";
  text: string;
}
/** A pending write-confirmation gate. */
interface Gate {
  gateId: string;
  tool: string;
  args: Record<string, unknown>;
  resolved?: "approved" | "denied";
}
/** A KB side-panel entry. */
interface KbEntry {
  id: string;
  question: string;
  answer: string;
  sources: KbSource[];
}

const DEFAULT_MODEL = "z-ai/glm-5.2";

export default function Builder() {
  const [params] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [setupMsg, setSetupMsg] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<OrModel[]>([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [sub, setSub] = useState<SubscriptionState | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | "">("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [gates, setGates] = useState<Gate[]>([]);
  const [kbEntries, setKbEntries] = useState<KbEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("Enter to send · Shift+Enter for newline");
  const [elapsed, setElapsed] = useState(0);
  const [cost, setCost] = useState(0);
  const [kbQuery, setKbQuery] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const sessionCostRef = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  // Elapsed-seconds timer: runs only while busy, so users see time passing
  // instead of a frozen screen during long agent turns (some run 2-3+ min).
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ID of the live "streaming" assistant row that deltas update in place.
  // null when no streaming row has been created yet for the current turn.
  const streamingRowIdRef = useRef<string | null>(null);

  // ── First-load guard: block the builder when the linked Genesis project
  //    has zero pages. noPagesProjectId holds the project id that was found
  //    empty (null = no block). The guard is dismissed only by the "I've
  //    created it" button after a re-check confirms pages now exist, or by a
  //    window-focus re-check that finds pages.
  const [noPagesProjectId, setNoPagesProjectId] = useState<number | null>(null);
  const [recheckingPages, setRecheckingPages] = useState(false);

  // ── Empty-project guard: query the linked project's page count. ───────────
  // Only pageCount === 0 (explicitly empty) shows the blocking modal. ok:false
  // (transient failure / indeterminate) clears any block so a user is never
  // locked out of a project that actually has pages.
  const checkPages = useCallback(async (pid: number) => {
    try {
      const r: PagesCountResult = await projectsApi.pageCount(pid);
      if (r.ok && r.pageCount === 0) {
        setNoPagesProjectId(pid);
      } else {
        setNoPagesProjectId(null);
      }
    } catch {
      // Network/parse failure on the client side — fail open, don't block.
      setNoPagesProjectId(null);
    }
  }, []);

  // ── Load profile + projects on mount ──────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const [p, pr] = await Promise.all([profileApi.get(), projectsApi.list()]);
      setHasKey(p.hasOpenRouterKey);
      setModels(p.models);
      setModel(p.preferredModel || DEFAULT_MODEL);
      setProjects(pr.projects);
      // Fetch subscription state for the trial-turn indicator + gating.
      try { setSub(await billingApi.subscription()); } catch { /* non-fatal */ }
      if (pr.projects.length === 0) {
        setSetupMsg("Connect a Genesis project to start building.");
      } else if (!p.hasOpenRouterKey && !(await billingApi.subscription()).usePlatformKey) {
        setSetupMsg("Add your OpenRouter key in Profile to start building.");
      } else {
        setSetupMsg(null);
        // pick project from query param, else the first one
        const qp = params.get("project");
        const initial = qp ? Number(qp) : pr.projects[0].id;
        if (pr.projects.some((x) => x.id === initial)) {
          setProjectId(initial);
          // First-load guard: after the project link resolves, check whether
          // the linked Genesis project has any pages. Fail-open — a transient
          // API error or indeterminate response never blocks the builder.
          void checkPages(initial);
        }
      }
    } catch (e) {
      setSetupMsg(e instanceof ApiError ? e.message : "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, [params, checkPages]);
  useEffect(() => { void load(); }, [load]);

  // Re-check on window focus while the modal is open, so the user can create
  // the page in another Genesis tab and come back without a full reload.
  useEffect(() => {
    if (noPagesProjectId === null) return;
    const onFocus = () => { if (noPagesProjectId !== null) void checkPages(noPagesProjectId); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [noPagesProjectId, checkPages]);

  // ── Resume a conversation if ?conversation= is present ────────────────────
  useEffect(() => {
    const qc = params.get("conversation");
    if (!qc || !projectId) return;
    const cid = Number(qc);
    if (!cid) return;
    (async () => {
      try {
        const d = await agentApi.getConversation(cid);
        setConversationId(d.conversation.id);
        const resumed: Row[] = [];
        for (const m of d.messages) {
          if (m.role === "user") resumed.push({ id: `h${m.id}`, kind: "user", text: m.content });
          else if (m.role === "assistant") {
            // Suppress technical tool-call preambles on resume. During a live
            // turn these are intentionally NOT rendered (agentLoop comment:
            // "raw self-correction text is not a useful customer-facing progress
            // signal"). But they were persisted and re-rendered as ASSISTANT
            // bubbles on resume, surfacing internal jargon (rpc('exec_sql'),
            // hasAdminSecret, edge function stub, etc.) to end users. Skip
            // assistant rows that carry tool_calls — the final answer row has
            // no tool_calls and is always shown. This matches the live-turn
            // behavior and keeps the resumed view jargon-free.
            if (m.toolCalls && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) continue;
            resumed.push({ id: `h${m.id}`, kind: "assistant", text: m.content });
          }
        }
        setRows(resumed);
      } catch { /* non-fatal */ }
    })();
  }, [params, projectId]);

  // ── Auto-scroll on new rows / gates ───────────────────────────────────────
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows, gates]);

  const addRow = (kind: Row["kind"], text: string) =>
    setRows((r) => [...r, { id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind, text }]);

  const dismissRow = (id: string) => setRows((r) => r.filter((row) => row.id !== id));

  // ── Send a message ────────────────────────────────────────────────────────
  async function send() {
    const text = input.trim();
    // Block submission while the empty-project guard is up.
    if (!text || busy || !projectId || noPagesProjectId !== null) return;
    setInput("");
    setBusy(true);
    setElapsed(0);
    setHint("Initiating your request…");
    addRow("user", text);

    // Start an elapsed-seconds counter so the user sees time passing
    // instead of a static line during long agent turns.
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    // Reset the streaming row tracker for this turn.
    streamingRowIdRef.current = null;

    const ctrl = new AbortController();
    const turnCostBase = sessionCostRef.current;
    abortRef.current = ctrl;

    try {
      await streamAgent(
        { genesisProjectId: projectId, conversationId: conversationId ?? undefined, message: text, model },
        {
          onStatus: (t) => setHint(t),
          onNarration: (t) => addRow("narration", t),
          onDelta: (t) => {
            // Stream partial content into a live assistant bubble. On the first
            // delta of a turn, create the row; on subsequent deltas, replace
            // its text with the accumulated content from the server. This gives
            // the user real-time text appearing instead of a frozen screen.
            if (!streamingRowIdRef.current) {
              const id = `stream-${Date.now()}`;
              streamingRowIdRef.current = id;
              setRows((r) => [...r, { id, kind: "assistant", text: t }]);
            } else {
              const sid = streamingRowIdRef.current;
              setRows((r) => r.map((row) => (row.id === sid ? { ...row, text: t } : row)));
            }
          },
          onConversation: (id) => setConversationId(id),
          onCost: (c) => {
            const runningSessionCost = turnCostBase + c;
            sessionCostRef.current = runningSessionCost;
            setCost(runningSessionCost);
          },
          onToolApprovalRequest: (gateId, tool, args) =>
            setGates((g) => [...g, { gateId, tool, args }]),
          onKbAnswer: (q, a, sources) =>
            setKbEntries((k) => [...k, { id: `kb-${Date.now()}`, question: q, answer: a, sources }]),
          onFinalAnswer: (t) => {
            // Replace the live streaming row with the final answer, or add a
            // new assistant row if no deltas arrived (e.g. a turn that went
            // straight to tool calls with no streamed content).
            const sid = streamingRowIdRef.current;
            if (sid) {
              setRows((r) => r.map((row) => (row.id === sid ? { ...row, text: t } : row)));
            } else {
              addRow("assistant", t);
            }
          },
          onError: (m) => addRow("error", m),
          onDone: () => setHint("Enter to send · Shift+Enter for newline"),
        },
        ctrl.signal
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        addRow("error", e instanceof ApiError ? e.message : (e as Error).message);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      setHint("Enter to send · Shift+Enter for newline");
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    }
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  // ── Approve / deny a gate ─────────────────────────────────────────────────
  async function resolveGate(gateId: string, approved: boolean) {
    setGates((g) => g.map((x) => (x.gateId === gateId ? { ...x, resolved: approved ? "approved" : "denied" } : x)));
    try { await agentApi.approveGate(gateId, approved); } catch { /* non-fatal */ }
  }

  async function dismissGate(gate: Gate) {
    if (!gate.resolved) {
      try { await agentApi.approveGate(gate.gateId, false); } catch { /* non-fatal */ }
    }
    setGates((g) => g.filter((x) => x.gateId !== gate.gateId));
  }

  // ── "I've created it" — re-run the page-count check and dismiss the blocking
  //    modal only if the project now has at least one page. If still empty, the
  //    modal stays open.
  async function recheckPagesAndMaybeDismiss() {
    if (noPagesProjectId === null) return;
    setRecheckingPages(true);
    try {
      await checkPages(noPagesProjectId);
    } finally {
      setRecheckingPages(false);
    }
  }

  // ── KB side-panel query ───────────────────────────────────────────────────
  async function askKb() {
    const q = kbQuery.trim();
    if (!q) return;
    setKbQuery("");
    setKbEntries((k) => [...k, { id: `pending-${Date.now()}`, question: q, answer: "…", sources: [] }]);
    try {
      const r = await agentApi.kbQuery(q);
      setKbEntries((k) =>
        k.map((en) => (en.question === q && en.answer === "…" ? { ...en, answer: r.answer, sources: r.sources } : en))
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setKbEntries((k) =>
        k.map((en) => (en.question === q && en.answer === "…" ? { ...en, answer: `Error: ${msg}` } : en))
      );
    }
  }

  // ── Model picker options ──────────────────────────────────────────────────
  const recModels = models.filter((m) => m._group === "Recommended");
  const restModels = models.filter((m) => m._group !== "Recommended");
  const opt = (m: OrModel) => {
    const ctxK = Math.round((m.context_length || 0) / 1000);
    const price = m.pricing && parseFloat(m.pricing.prompt || "0");
    const priceStr = price ? `$${(price * 1e6).toFixed(2)}/M` : "—";
    return `${m.name || m.id} — ${ctxK}k · ${priceStr}`;
  };

  const costClass = cost >= 1.0 ? "high" : cost >= 0.25 ? "warn" : "";

  // The currently-selected project (for the Genesis open-in-builder link).
  const currentProject = projects.find((p) => p.id === projectId) || null;
  // Genesis builder URL for the linked project. The MCP URL has the shape
  // https://genesis.estage.com/api/agent/<projectId>/mcp; the project's builder
  // UI lives at https://genesis.estage.com/<projectId>. Fall back to the app
  // root if we can't derive the id.
  const genesisBuilderUrl = currentProject?.genesisProjectId
    ? `https://genesis.estage.com/${currentProject.genesisProjectId}`
    : "https://genesis.estage.com/";

  return (
    <div className="app-wrap">
      <div className="app-glow" />
      <AppNav />
      {/* First-load guard: blocking modal when the linked Genesis project has
          zero pages. Instructional only — no create-page action (the Genesis
          API can't scaffold into a project with no file structure). */}
      {noPagesProjectId !== null && (
        <div className="gw-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="gw-no-pages-title">
          <div className="gw-modal">
            <h2 id="gw-no-pages-title">Add a page in Genesis first.</h2>
            <p className="gw-modal-body">
              This Genesis project is empty, so there&rsquo;s nothing here to build on yet.
              Open the project in Genesis and create a single blank page, or a home page,
              then come back. Once one page exists, you can build, edit, and change anything
              from here.
            </p>
            <div className="gw-modal-actions">
              <a
                className="btn btn-primary"
                href={genesisBuilderUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Genesis.
              </a>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={recheckingPages}
                onClick={() => void recheckPagesAndMaybeDismiss()}
              >
                {recheckingPages ? "Checking…" : "I&rsquo;ve created it"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="builder">
        {/* header: project + model + cost */}
        <div className="b-head">
          <select
            className="proj-sel"
            value={projectId}
            onChange={(e) => {
              const next = Number(e.target.value);
              setProjectId(next);
              setRows([]);
              setConversationId(null);
              sessionCostRef.current = 0;
              setCost(0);
              // Re-run the empty-project guard for the newly-selected project.
              setNoPagesProjectId(null);
              if (next) void checkPages(next);
            }}
            disabled={busy}
          >
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="sp" />
          <select className="b-model" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy || !hasKey}>
            {recModels.length > 0 && (
              <optgroup label="★ Recommended">
                {recModels.map((m) => <option key={m.id} value={m.id}>{opt(m)}</option>)}
              </optgroup>
            )}
            <optgroup label="All capable">
              {restModels.map((m) => <option key={m.id} value={m.id}>{opt(m)}</option>)}
            </optgroup>
          </select>
          <span className={`cost-badge ${costClass}`} title="Running total for this Builder session, including every instruction and agent turn">
            <span className="session-cost-label">Session</span>
            <span className="coin">$</span>{cost.toFixed(4)}
          </span>
          {/* Trial-turn indicator / lapsed / upgrade prompt */}
          {sub && sub.tier === "trial" && (
            <a
              className={`trial-chip ${sub.canStartTurn ? "" : "urgent"}`}
              href="/billing"
              title="Upgrade to keep building"
            >
              {sub.canStartTurn
                ? `Trial: ${sub.trialTurnCap - sub.trialTurnsUsed} turn${sub.trialTurnCap - sub.trialTurnsUsed === 1 ? "" : "s"} left · Upgrade`
                : "Trial used up · Upgrade to keep building"}
            </a>
          )}
          {sub && sub.tier === "lapsed" && (
            <a className="trial-chip urgent" href="/billing" title="Resubscribe to resume building">
              Lapsed · Resubscribe
            </a>
          )}
        </div>

        {/* body: chat + KB panel */}
        <div className="b-body">
          <div className="b-chat">
            {loading ? (
              <div className="setup-gate"><p>Loading…</p></div>
            ) : setupMsg ? (
              <div className="setup-gate">
                <h2>Almost ready</h2>
                <p>{setupMsg}</p>
                <div className="btn-row">
                  {!hasKey && <a className="btn btn-primary" href="/profile">Add OpenRouter key</a>}
                  {projects.length === 0 && <a className="btn btn-ghost" href="/projects">Connect a project</a>}
                </div>
              </div>
            ) : (
              <>
                <div className="b-messages" ref={messagesRef}>
                  {rows.length === 0 && !busy && (
                    <div className="kb-empty" style={{ padding: "60px 14px" }}>
                      Describe what you want to build or change. The agent reads your project, makes edits through Genesis, and asks before any high-impact action.
                    </div>
                  )}
                  {rows.map((r) => (
                    <div key={r.id} className={`msg ${r.kind}`}>
                      <div className="role">{r.kind === "user" ? "You" : r.kind === "error" ? "Error" : "Assistant"}</div>
                      {r.kind !== "user" && (
                        <button className="msg-close" type="button" onClick={() => dismissRow(r.id)} aria-label="Dismiss message" title="Dismiss message">×</button>
                      )}
                      <div className="bubble" dangerouslySetInnerHTML={{ __html: mdToHtml(r.text) }} />
                    </div>
                  ))}
                  {busy && (
                    <div className="thinking" aria-live="polite">
                      <span className="dots" />
                      <span className="dots" />
                      <span className="dots" />
                      <span className="t-text">{hint}</span>
                      <span className="t-elapsed">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
                    </div>
                  )}
                  {gates.map((g) => (
                    <div className="gate" key={g.gateId}>
                      <div className="g-head">
                        <span className="g-badge">⚠️ confirm</span>
                        <span className="g-tool">{g.tool}</span>
                        <button className="msg-close gate-close" type="button" onClick={() => void dismissGate(g)} aria-label="Dismiss confirmation" title="Dismiss confirmation">×</button>
                      </div>
                      <div className="g-msg">
                        {g.resolved
                          ? g.resolved === "approved" ? "Approved — running." : "Denied — skipped."
                          : "This is a high-impact Genesis operation. Approve before it runs:"}
                      </div>
                      {!g.resolved && (
                        <>
                          <div className="g-args">{JSON.stringify(g.args, null, 2)}</div>
                          <div className="g-actions">
                            <button className="btn btn-approve" onClick={() => resolveGate(g.gateId, true)}>Approve</button>
                            <button className="btn btn-deny" onClick={() => resolveGate(g.gateId, false)}>Deny</button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* composer */}
                <div className="b-composer">
                  <div className="b-composer-row">
                    <textarea
                      placeholder="Describe what you want to build or change…"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
                      }}
                      rows={1}
                      style={{ height: "auto" }}
                      onInput={(e) => {
                        const t = e.currentTarget;
                        t.style.height = "auto";
                        t.style.height = Math.min(t.scrollHeight, 160) + "px";
                      }}
                    />
                    {busy ? (
                      <button className="b-stop" onClick={stop}>Stop</button>
                    ) : (
                      <button className="b-send" onClick={() => void send()} disabled={!input.trim() || !projectId}>Send</button>
                    )}
                  </div>
                  <div className={`b-hint ${hint !== "Enter to send · Shift+Enter for newline" ? "active" : ""}`}>{hint}</div>
                </div>
              </>
            )}
          </div>

          {/* KB side panel */}
          <div className="b-kb">
            <div className="b-kb-head">
              <h3>eStage knowledge base</h3>
              <input
                className="kb-in"
                placeholder="Ask about a Genesis capability…"
                value={kbQuery}
                onChange={(e) => setKbQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && askKb()}
              />
            </div>
            <div className="b-kb-body">
              {kbEntries.length === 0 ? (
                <div className="kb-empty">Manual KB lookups appear here. The agent also consults the KB automatically before uncertain writes.</div>
              ) : (
                kbEntries.map((e) => (
                  <div className="kb-entry" key={e.id}>
                    <div className="q">{e.question}</div>
                    <div className="a" dangerouslySetInnerHTML={{ __html: mdToHtml(e.answer) }} />
                    {e.sources.length > 0 && (
                      <div className="src">
                        {e.sources.map((s, i) => (
                          <span key={i}>
                            {i > 0 && " · "}
                            {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a> : (s.title || "")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

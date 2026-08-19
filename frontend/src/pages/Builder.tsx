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
  const [cost, setCost] = useState(0);
  const [kbQuery, setKbQuery] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

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
        if (pr.projects.some((x) => x.id === initial)) setProjectId(initial);
      }
    } catch (e) {
      setSetupMsg(e instanceof ApiError ? e.message : "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, [params]);
  useEffect(() => { void load(); }, [load]);

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
          else if (m.role === "assistant") resumed.push({ id: `h${m.id}`, kind: "assistant", text: m.content });
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
    if (!text || busy || !projectId) return;
    setInput("");
    setBusy(true);
    setHint("Initiating your request…");
    addRow("user", text);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await streamAgent(
        { genesisProjectId: projectId, conversationId: conversationId ?? undefined, message: text, model },
        {
          onStatus: (t) => setHint(t),
          onNarration: (t) => addRow("narration", t),
          onConversation: (id) => setConversationId(id),
          onCost: (c) => setCost(c),
          onToolApprovalRequest: (gateId, tool, args) =>
            setGates((g) => [...g, { gateId, tool, args }]),
          onKbAnswer: (q, a, sources) =>
            setKbEntries((k) => [...k, { id: `kb-${Date.now()}`, question: q, answer: a, sources }]),
          onFinalAnswer: (t) => addRow("assistant", t),
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

  return (
    <div className="app-wrap">
      <div className="app-glow" />
      <AppNav />
      <div className="builder">
        {/* header: project + model + cost */}
        <div className="b-head">
          <select
            className="proj-sel"
            value={projectId}
            onChange={(e) => { setProjectId(Number(e.target.value)); setRows([]); setConversationId(null); setCost(0); }}
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
          <span className={`cost-badge ${costClass}`} title="Running OpenRouter cost this session">
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
                      {hint}
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

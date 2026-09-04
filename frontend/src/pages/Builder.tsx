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
  type BlueprintInterpretation,
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

function historyUserText(content: string): string {
  if (!content.includes("<business_blueprint_json>")) return content;
  const match = content.match(/<business_blueprint_json>\s*([\s\S]*?)\s*<\/business_blueprint_json>/);
  try {
    const blueprint = JSON.parse(match?.[1] || "{}") as { workingTitle?: string; businessName?: string; paidProduct?: { name?: string } };
    const title = blueprint.workingTitle || blueprint.businessName || blueprint.paidProduct?.name || "business blueprint";
    return `Imported blueprint: **${title}**`;
  } catch {
    return "Imported business blueprint";
  }
}

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
  const [builderMode, setBuilderMode] = useState<"choose" | "idea" | "blueprint-paste" | "blueprint-review">("choose");
  const [blueprintText, setBlueprintText] = useState("");
  const [blueprintResult, setBlueprintResult] = useState<BlueprintInterpretation | null>(null);
  const [blueprintError, setBlueprintError] = useState<string | null>(null);
  const [interpretingBlueprint, setInterpretingBlueprint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("Enter to send · Shift+Enter for newline");
  const [elapsed, setElapsed] = useState(0);
  const [cost, setCost] = useState(0);
  const [kbQuery, setKbQuery] = useState("");
  // Set when the backend signals a timeout_retry_available event; holds the
  // conversationId to retry with compressed history. Cleared on send/stop.
  const [retryAvailable, setRetryAvailable] = useState<number | null>(null);
  // Pending image attachment (base64 data URL) for the next message.
  // Set when the user picks an image via the + button; cleared on send.
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
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
      // Fetch subscription state for the access indicator + gating (one call).
      let s: Awaited<ReturnType<typeof billingApi.subscription>> | null = null;
      try {
        s = await billingApi.subscription();
        setSub(s);
      } catch { /* non-fatal */ }
      if (pr.projects.length === 0) {
        setSetupMsg("Connect a Genesis project to start building.");
      } else if (!p.hasOpenRouterKey && s && !s.usePlatformKey) {
        // In free mode this is the handover point: the intro turns on our key
        // are used up, and the user continues free on their own key.
        setSetupMsg(
          s.freeMode
            ? "You've used your free intro turns. GenWhisperer stays free — add your own OpenRouter key in Profile to keep building."
            : "Add your OpenRouter key in Profile to start building."
        );
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
        setBuilderMode("idea");
        const resumed: Row[] = [];
        for (const m of d.messages) {
          if (m.role === "user") resumed.push({ id: `h${m.id}`, kind: "user", text: historyUserText(m.content) });
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
  // compressHistory: when true (the "Retry with shorter history" button), the
  // server trims replayed history before sending to the model.
  async function send(compressHistory = false, messageOverride?: string, displayOverride?: string) {
    const text = (messageOverride ?? input).trim();
    // Block submission while the empty-project guard is up.
    // Allow send with an image even if text is empty (the user might just
    // share an image with no message). But require either text or an image.
    if (busy || !projectId || noPagesProjectId !== null) return;
    if (!text && !pendingImage) return;
    const imageToSend = pendingImage;
    setInput("");
    setPendingImage(null);
    setBusy(true);
    setElapsed(0);
    setRetryAvailable(null);
    setHint("Initiating your request…");
    addRow("user", displayOverride || text || "📎 Shared an image");

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
        { genesisProjectId: projectId, conversationId: conversationId ?? undefined, message: text, model, compressHistory, image: imageToSend },
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
          onTimeoutRetryAvailable: (cid) => setRetryAvailable(cid),
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

  async function interpretBlueprint() {
    setBlueprintError(null);
    setInterpretingBlueprint(true);
    try {
      const result = await agentApi.interpretBlueprint(blueprintText);
      setBlueprintResult(result);
      setBuilderMode("blueprint-review");
    } catch (error) {
      setBlueprintError(error instanceof ApiError ? error.message : "The blueprint could not be interpreted.");
    } finally {
      setInterpretingBlueprint(false);
    }
  }

  async function startBlueprintBuild() {
    if (!blueprintResult || !projectId) return;
    setBuilderMode("idea");
    const title = blueprintResult.blueprint.workingTitle || blueprintResult.blueprint.businessName || blueprintResult.blueprint.paidProduct.name || "business blueprint";
    await send(false, blueprintResult.agentMessage, `Imported blueprint: **${title}**`);
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
    const imgBadge = m._supportsImages ? " 📷 image" : "";
    return `${m.name || m.id} — ${ctxK}k · ${priceStr}${imgBadge}`;
  };

  const costClass = cost >= 1.0 ? "high" : cost >= 0.25 ? "warn" : "";
  // Whether the currently-selected model supports image/vision input.
  // Check the models array first (set from the OpenRouter API response),
  // with a prefix fallback for known vision model families in case the
  // models array is momentarily stale during a re-render.
  const VISION_PREFIXES = ["openai/gpt", "anthropic/claude", "google/gemini", "xai/grok"];
  const modelSupportsImages =
    models.find((m) => m.id === model)?._supportsImages ??
    VISION_PREFIXES.some((p) => model.startsWith(p));

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
          {/* Access indicator. Free mode: shows the remaining intro turns on
              our key, then either "running on your key" or a prompt to add one
              (pointing at Profile, not Billing — it's setup, not a paywall). */}
          {sub && sub.freeMode && (sub.tier === "trial" || sub.tier === "lapsed") && (
            sub.needsOwnKey ? (
              <a className="trial-chip urgent" href="/profile" title="Still free — add your own OpenRouter key to keep building">
                Free · Add your OpenRouter key
              </a>
            ) : sub.usePlatformKey ? (
              <span className="trial-chip" title="Your first turns run on our key — after that, add your own and keep going free">
                {`Free · ${sub.trialTurnCap - sub.trialTurnsUsed} intro turn${sub.trialTurnCap - sub.trialTurnsUsed === 1 ? "" : "s"} on us`}
              </span>
            ) : (
              <span className="trial-chip" title="Free access — running on your own OpenRouter key">
                Free · your OpenRouter key
              </span>
            )
          )}
          {sub && !sub.freeMode && sub.tier === "trial" && (
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
          {sub && !sub.freeMode && sub.tier === "lapsed" && (
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
            ) : builderMode === "choose" ? (
              <div className="blueprint-flow blueprint-chooser">
                <div className="blueprint-intro">
                  <span className="blueprint-eyebrow">Choose a starting point</span>
                  <h1>What are you bringing into the Builder?</h1>
                  <p>You can start a normal conversation or bring in a business plan created elsewhere.</p>
                </div>
                <div className="blueprint-choice-grid">
                  <button className="blueprint-choice" type="button" onClick={() => setBuilderMode("idea")}>
                    <span className="blueprint-choice-icon">✦</span>
                    <strong>Start with an idea</strong>
                    <span>Describe what you want to build or change, just as before.</span>
                  </button>
                  <button className="blueprint-choice" type="button" onClick={() => setBuilderMode("blueprint-paste")}>
                    <span className="blueprint-choice-icon">⇩</span>
                    <strong>Import a business blueprint</strong>
                    <span>Paste JSON, Markdown, or plain text, then review it before anything runs.</span>
                  </button>
                </div>
              </div>
            ) : builderMode === "blueprint-paste" ? (
              <div className="blueprint-flow">
                <button className="blueprint-back" type="button" onClick={() => setBuilderMode("choose")}>← Back</button>
                <div className="blueprint-card">
                  <span className="blueprint-step">Step 1 of 2</span>
                  <h1>Import Business Blueprint</h1>
                  <p>Paste the business blueprint generated by the Opportunity Architect. GenWhisperer will review it before making any changes to your Genesis project.</p>
                  <label htmlFor="blueprint-input">Business blueprint</label>
                  <textarea
                    id="blueprint-input"
                    className="blueprint-textarea"
                    value={blueprintText}
                    onChange={(event) => setBlueprintText(event.target.value)}
                    placeholder="Paste JSON, Markdown, or plain text here…"
                    maxLength={20_001}
                  />
                  <div className="blueprint-security"><strong>Keep secrets out.</strong> Never paste OpenRouter keys, Genesis tokens, passwords, payment credentials, or customer personal information.</div>
                  {blueprintError && <div className="blueprint-error" role="alert">{blueprintError}</div>}
                  <div className="blueprint-actions">
                    <span>{blueprintText.length.toLocaleString()} / 20,000 characters</span>
                    <button className="btn btn-primary" type="button" disabled={interpretingBlueprint || !blueprintText.trim()} onClick={() => void interpretBlueprint()}>
                      {interpretingBlueprint ? "Reviewing…" : "Review blueprint"}
                    </button>
                  </div>
                  <p className="blueprint-footnote">Reviewing does not call OpenRouter, consume model tokens, contact Genesis, or change your project.</p>
                </div>
              </div>
            ) : builderMode === "blueprint-review" && blueprintResult ? (
              <div className="blueprint-flow">
                <button className="blueprint-back" type="button" onClick={() => setBuilderMode("blueprint-paste")}>← Edit or replace blueprint</button>
                <div className="blueprint-card blueprint-review">
                  <span className="blueprint-step">Step 2 of 2 · {blueprintResult.inputFormat.replace("_", " ")}</span>
                  <h1>Review before building</h1>
                  {blueprintResult.warnings.map((warning) => <div className="blueprint-warning" key={warning}>{warning}</div>)}
                  <div className="blueprint-summary">
                    <div><span>Working name</span><strong>{blueprintResult.blueprint.workingTitle || blueprintResult.blueprint.businessName || "Not provided"}</strong></div>
                    <div><span>Target audience</span><strong>{blueprintResult.blueprint.audience}</strong></div>
                    <div><span>Problem</span><strong>{blueprintResult.blueprint.customerProblem}</strong></div>
                    <div><span>Lead magnet</span><strong>{blueprintResult.blueprint.leadMagnet.name || blueprintResult.blueprint.leadMagnet.description || "To clarify with the agent"}</strong></div>
                    <div><span>Paid digital kit</span><strong>{blueprintResult.blueprint.paidProduct.name || blueprintResult.blueprint.paidProduct.description}</strong></div>
                    <div><span>Suggested price</span><strong>{blueprintResult.blueprint.paidProduct.suggestedPrice || "Not provided"}</strong></div>
                    <div><span>Required pages</span><strong>{blueprintResult.blueprint.requiredPages?.join(", ") || "Sales, lead magnet, and thank-you/access pages"}</strong></div>
                    <div><span>Delivery</span><strong>{blueprintResult.blueprint.delivery?.method || blueprintResult.blueprint.delivery?.accessInstructions || "Immediate access/delivery; details to clarify"}</strong></div>
                    <div><span>Follow-up sequence</span><strong>{blueprintResult.blueprint.followUpEmails?.length ? `${blueprintResult.blueprint.followUpEmails.length} email${blueprintResult.blueprint.followUpEmails.length === 1 ? "" : "s"}` : "Short sequence; details to clarify"}</strong></div>
                  </div>
                  <div className="blueprint-review-section">
                    <h2>Assumptions and missing information</h2>
                    <p>{[...(blueprintResult.blueprint.assumptions || []), ...blueprintResult.missingFields].join(" · ") || "No material gaps identified by the importer. The agent will still confirm its understanding."}</p>
                  </div>
                  <div className="blueprint-selection">
                    <label>Genesis project<select value={projectId} onChange={(event) => setProjectId(Number(event.target.value))}>
                      <option value="">Select a connected project</option>
                      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select></label>
                    <label>OpenRouter model<select value={model} onChange={(event) => setModel(event.target.value)}>
                      {models.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
                    </select></label>
                  </div>
                  {projects.length === 0 && <div className="blueprint-error">No Genesis project is connected. <a href="/projects">Connect a project</a> to continue.</div>}
                  {!hasKey && !sub?.usePlatformKey && <div className="blueprint-error">No OpenRouter key is available. <a href="/profile">Add your key</a> to continue.</div>}
                  <div className="blueprint-actions">
                    <span>Nothing changes until you press the button.</span>
                    <button className="btn btn-primary" type="button" disabled={!projectId || (!hasKey && !sub?.usePlatformKey)} onClick={() => void startBlueprintBuild()}>Review with GenWhisperer</button>
                  </div>
                </div>
              </div>
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
                  {retryAvailable !== null && !busy && (
                    <div className="retry-bar">
                      <span className="retry-msg">The model took too long to respond. We suggest switching to a faster model (such as Qwen 3.8 Flash, Claude 3.5 Sonnet, or Gemini Flash) from the dropdown above, or retrying with a shorter conversation history.</span>
                      <div className="retry-actions">
                        <button className="btn btn-retry" onClick={() => void send(true)}>Retry with shorter history</button>
                        <button className="btn btn-ghost" onClick={() => void send()}>Try again</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* composer */}
                <div className="b-composer">
                  {pendingImage && (
                    <div className="img-preview">
                      <img src={pendingImage} alt="Pending upload" className="img-thumb" />
                      <button className="img-remove" type="button" onClick={() => setPendingImage(null)} aria-label="Remove image" title="Remove image">×</button>
                    </div>
                  )}
                  <div className="b-composer-row">
                    {modelSupportsImages && !busy && (
                      <>
                        <button
                          className="b-attach"
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          aria-label="Attach image"
                          title="Attach an image for the model to reference"
                        >+</button>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 4 * 1024 * 1024) {
                              alert("Image must be under 4MB.");
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = () => setPendingImage(reader.result as string);
                            reader.readAsDataURL(file);
                            // Reset so the same file can be picked again
                            e.target.value = "";
                          }}
                        />
                      </>
                    )}
                    <textarea
                      placeholder={modelSupportsImages ? "Describe what you want to build or change. Attach an image with + or paste it here…" : "Describe what you want to build or change…"}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onPaste={(e) => {
                        // If the user pastes an image (from clipboard, screenshot,
                        // or copied image), capture it as the pending image —
                        // same as the + button. Only for vision-capable models.
                        if (!modelSupportsImages || busy) return;
                        const items = e.clipboardData?.items;
                        if (!items) return;
                        for (const item of items) {
                          if (item.type.startsWith("image/")) {
                            const file = item.getAsFile();
                            if (!file) return;
                            if (file.size > 4 * 1024 * 1024) {
                              alert("Image must be under 4MB.");
                              e.preventDefault();
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = () => setPendingImage(reader.result as string);
                            reader.readAsDataURL(file);
                            // Prevent the image filename/placeholder text
                            // from being pasted into the textarea.
                            e.preventDefault();
                            return;
                          }
                        }
                      }}
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
                      <button className="b-send" onClick={() => void send()} disabled={(!input.trim() && !pendingImage) || !projectId}>Send</button>
                    )}
                  </div>
                  <div className={`b-hint ${hint !== "Enter to send · Shift+Enter for newline" ? "active" : ""}`}>{hint}</div>
                  {!modelSupportsImages && (
                    <div className="img-note">Need to upload an image to reference? Switch to a model that supports image (📷) in the model picker above.</div>
                  )}
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

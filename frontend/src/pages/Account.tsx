import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { account, chat, ApiError, type ChatStatus } from "../lib/api";
import { CURATED_MODELS, availableCuratedModels, type CuratedModel } from "../lib/models";
import { useAuth } from "../lib/auth";
import { Brand } from "../components/Brand";
import "./App.css";

export default function Account() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("deepseek/deepseek-v4-pro");
  const [modelOptions, setModelOptions] = useState<CuratedModel[]>(CURATED_MODELS);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function load() {
    chat.status().then((s) => {
      setStatus(s);
      setModel(s.preferredModel || "deepseek/deepseek-v4-pro");
    }).catch(() => {});
  }

  useEffect(() => {
    load();
    // Fetch live model list and intersect with curated list
    chat.models()
      .then((r) => {
        const ids = r.models.map((m) => m.id);
        setModelOptions(availableCuratedModels(ids));
      })
      .catch(() => {
        // On error keep the full curated list as fallback
        setModelOptions(CURATED_MODELS);
      });
  }, []);

  async function saveKey() {
    const key = apiKey.trim();
    if (!key.startsWith("sk-or-")) {
      setMsg({ kind: "err", text: "That doesn't look like an OpenRouter key (they start with sk-or-)." });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      await account.saveKey(key, model);
      setApiKey("");
      setMsg({ kind: "ok", text: "Key saved. You're now on your own key — usage is unlimited." });
      load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Couldn't save the key. Try again." });
    } finally { setBusy(false); }
  }

  async function removeKey() {
    setBusy(true); setMsg(null);
    try {
      await account.removeKey();
      setMsg({ kind: "ok", text: "Key removed. You're back on the free trial." });
      load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Couldn't remove the key." });
    } finally { setBusy(false); }
  }

  function saveModel(next: string) {
    setModel(next);
  }
  async function commitModel(next: string) {
    if (!status?.hasOwnKey) return; // model only applies once they're on own key
    try {
      await account.setModel(next);
      setMsg({ kind: "ok", text: "Model preference updated." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "Couldn't update the model. Try again." });
    }
  }

  return (
    <div>
      <header className="app-head">
        <Brand />
        <div className="sp" />
        <button className="btn btn-ghost btn-sm" onClick={() => nav("/chat")}>Back to chat</button>
      </header>

      <main className="app-main">
        <h1 className="app-h1">Account</h1>
        <p className="app-sub mono">{user?.email}</p>

        {msg && <div className={`banner ${msg.kind === "ok" ? "banner-ok" : "banner-err"}`}>{msg.text}</div>}

        {user?.role !== "admin" && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 4 }}>OpenRouter API key</h3>
          {status?.hasOwnKey ? (
            <>
              <p className="app-sub">Your key is connected and stored encrypted. We only ever show the masked value.</p>
              <div className="field">
                <label>Connected key</label>
                <input className="inp mono" value={status.maskedKey ?? ""} readOnly />
              </div>
              <button className="btn btn-danger btn-sm" onClick={removeKey} disabled={busy}>Remove key</button>
            </>
          ) : (
            <>
              <p className="app-sub">
                {status?.trialExhausted
                  ? "Your free trial is used up. Add your key to keep building."
                  : `You're on the free trial (${status?.trialMessagesUsed ?? 0} of ${status?.trialMessageCap ?? 5} used). Add a key anytime for unlimited use.`}
              </p>

              <div className="explainer">
                <h4>What's an API key?</h4>
                <p>
                  GenWhisperer talks to an AI model to write your Genesis prompts. After your free
                  messages, you connect your own AI account so you only ever pay the AI provider directly,
                  at cost. That connection is done with an "API key" — think of it as a password that lets
                  GenWhisperer use your account on your behalf. It's safe: we encrypt it, never show it
                  again, and you can remove it anytime.
                </p>
                <p><b>How to get one (takes 2 minutes):</b></p>
                <ol>
                  <li>Create a free account at <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">openrouter.ai</a>.</li>
                  <li>Add a little credit to your account (you pay the AI provider directly, per use).</li>
                  <li>Go to <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">openrouter.ai/keys</a> and click "Create Key".</li>
                  <li>Copy the key (it starts with <span className="mono">sk-or-</span>) and paste it below.</li>
                </ol>
              </div>

              <div className="field">
                <label htmlFor="key">Key <span className="hint">— get one at openrouter.ai/keys</span></label>
                <input id="key" className="inp mono" type="password" placeholder="sk-or-v1-..."
                  value={apiKey} autoComplete="off" spellCheck={false}
                  onChange={(e) => setApiKey(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={saveKey} disabled={busy || !apiKey.trim()}>
                {busy ? <span className="spin" /> : "Save key"}
              </button>
            </>
          )}
        </div>
        )}

        <div className="panel">
          <h3 style={{ marginBottom: 4 }}>Model</h3>
          <p className="app-sub">
            {status?.hasOwnKey
              ? "Which OpenRouter model your prompts run on."
              : "While on the free trial, the model is set by GenWhisperer. This applies once you add your own key."}
          </p>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="model">Preferred model</label>
            <select
              id="model"
              className="sel"
              value={model}
              disabled={user?.role !== "admin" && !status?.hasOwnKey}
              onChange={(e) => {
                saveModel(e.target.value);
                commitModel(e.target.value);
              }}
            >
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.label} — {m.note}</option>
              ))}
            </select>
          </div>
        </div>
      </main>
    </div>
  );
}

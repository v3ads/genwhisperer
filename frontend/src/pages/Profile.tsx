import { useEffect, useState } from "react";
import { AppNav } from "../components/AppNav";
import { profile as profileApi, ApiError, type OrModel } from "../lib/api";
import "./App.css";

/**
 * Profile page (V2) — the tenant's OpenRouter key + preferred model.
 *
 * Replaces v1's Account page. The key is validated against OpenRouter before
 * saving (server-side), encrypted at rest, and never returned in plaintext.
 * The model picker lists the curated Option A models (function-calling +
 * ≥128k context) fetched with the tenant's own key. Links to the in-app
 * /guide/openrouter-key guide.
 */
export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [hasKey, setHasKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [models, setModels] = useState<OrModel[]>([]);
  const [preferredModel, setPreferredModel] = useState("z-ai/glm-5.2");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function load() {
    try {
      const p = await profileApi.get();
      setHasKey(p.hasOpenRouterKey);
      setMaskedKey(p.maskedKey);
      setModels(p.models);
      setPreferredModel(p.preferredModel);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load profile.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function saveKey() {
    const v = apiKeyInput.trim();
    if (!v) { setErr("Paste an OpenRouter API key first."); return; }
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await profileApi.saveKey(v, preferredModel);
      setHasKey(true);
      setMaskedKey(r.maskedKey);
      setApiKeyInput("");
      setOk("Key saved and validated. Models refreshed.");
      void load(); // refresh model list with the new key
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save key.");
    } finally { setBusy(false); }
  }

  async function removeKey() {
    setBusy(true); setErr(null); setOk(null);
    try {
      await profileApi.removeKey();
      setHasKey(false); setMaskedKey(null); setModels([]);
      setOk("Key removed.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not remove key.");
    } finally { setBusy(false); }
  }

  async function changeModel(id: string) {
    setPreferredModel(id);
    if (!hasKey) return;
    try { await profileApi.setModel(id); } catch { /* non-fatal */ }
  }

  const recModels = models.filter((m) => m._group === "Recommended");
  const restModels = models.filter((m) => m._group !== "Recommended");
  const opt = (m: OrModel) => {
    const ctxK = Math.round((m.context_length || 0) / 1000);
    const price = m.pricing && parseFloat(m.pricing.prompt || "0");
    const priceStr = price ? `$${(price * 1e6).toFixed(2)}/M` : "—";
    return `${m.name || m.id} — ${ctxK}k ctx · ${priceStr}`;
  };

  return (
    <div className="app-wrap">
      <div className="app-glow" />
      <AppNav />
      <main className="app-main">
        {err && <div className="banner banner-err">{err}</div>}
        {ok && <div className="banner banner-ok">{ok}</div>}

        <div className="card">
          <h2>OpenRouter API key</h2>
          <p className="sub">
            Your key runs the AI model that drives the Genesis agent. It's encrypted at rest and
            never sent to your browser.{" "}
            <a className="link-inline" href="/guide/openrouter-key">How do I get one?</a>
          </p>

          {hasKey ? (
            <>
              <div className="fld">
                <label>Current key</label>
                <div className="inp mono" style={{ fontFamily: "'JetBrains Mono',monospace", color: "var(--teal)" }}>
                  {maskedKey}
                </div>
                <div className="hint">Saved and validated. Replace it by entering a new key below.</div>
              </div>
              <div className="fld">
                <label htmlFor="newkey">Replace key (optional)</label>
                <input
                  id="newkey" className="inp" type="password" placeholder="sk-or-v1-…"
                  value={apiKeyInput} autoComplete="off"
                  onChange={(e) => setApiKeyInput(e.target.value)}
                />
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" onClick={saveKey} disabled={busy || !apiKeyInput.trim()}>
                  {busy ? "Saving…" : "Update key"}
                </button>
                <button className="btn btn-ghost" onClick={removeKey} disabled={busy}>Remove key</button>
              </div>
            </>
          ) : (
            <>
              <div className="fld">
                <label htmlFor="newkey">OpenRouter API key</label>
                <input
                  id="newkey" className="inp" type="password" placeholder="sk-or-v1-…"
                  value={apiKeyInput} autoComplete="off" autoFocus
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveKey()}
                />
                <div className="hint">
                  Get one at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">openrouter.ai/keys</a>. We validate it before saving.
                </div>
              </div>
              <button className="btn btn-primary" onClick={saveKey} disabled={busy || !apiKeyInput.trim()} style={{ width: "auto" }}>
                {busy ? "Validating…" : "Save key"}
              </button>
            </>
          )}
        </div>

        <div className="card">
          <h2>Model</h2>
          <p className="sub">
            Only function-calling-capable models with ≥128k context are listed (the agent's tool
            payload is large). <b>GLM 5.2</b> is the default — huge context, low cost.
          </p>
          {loading ? (
            <p style={{ color: "var(--text-faint)", fontSize: 14 }}>Loading models…</p>
          ) : !hasKey ? (
            <p style={{ color: "var(--text-faint)", fontSize: 14 }}>
              Save an OpenRouter key to load the model list.
            </p>
          ) : models.length === 0 ? (
            <p style={{ color: "var(--warn)", fontSize: 14 }}>
              Couldn't fetch the model list with this key. Check the key at openrouter.ai/keys.
            </p>
          ) : (
            <div className="fld" style={{ marginBottom: 0 }}>
              <select value={preferredModel} onChange={(e) => changeModel(e.target.value)}>
                {recModels.length > 0 && (
                  <optgroup label="★ Recommended (strong agent models)">
                    {recModels.map((m) => <option key={m.id} value={m.id}>{opt(m)}</option>)}
                  </optgroup>
                )}
                <optgroup label="All capable models">
                  {restModels.map((m) => <option key={m.id} value={m.id}>{opt(m)}</option>)}
                </optgroup>
              </select>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

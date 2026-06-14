import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { chat, streamChat, type ChatMessage, type ChatStatus, type TrialExhausted } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Brand, Mark } from "../components/Brand";
import { AssistantContent } from "../components/AssistantContent";
import "./Chat.css";

const STARTERS = [
  "I want a landing page for my coaching business",
  "Add a contact form that saves messages and emails me",
  "Build a product catalog I can edit myself",
  "Set up Meta Pixel and Google Analytics tracking",
];

export default function Chat() {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [walled, setWalled] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    chat.status().then((s) => {
      setStatus(s);
      if (s.trialExhausted && !s.hasOwnKey) setWalled(true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    if (walled) return;

    const next = [...messages, { role: "user", content } as ChatMessage];
    setMessages(next);
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    setBusy(true);
    setStreaming("");

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const final = await streamChat(next, (full) => setStreaming(full), controller.signal);
      setMessages((m) => [...m, { role: "assistant", content: final }]);
      setStreaming("");
      // refresh trial counter
      chat.status().then(setStatus).catch(() => {});
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      const te = e as TrialExhausted;
      if (te?.trialExhausted) {
        setWalled(true);
        setStreaming("");
        setStatus((s) => s && { ...s, trialExhausted: true, trialMessagesUsed: te.trialMessagesUsed });
        // drop the optimistic user msg that didn't get answered
        setMessages((m) => m.slice(0, -1));
        setInput(content);
      } else {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: "Something interrupted that response. Try sending it again." },
        ]);
        setStreaming("");
      }
    } finally {
      setBusy(false);
    }
  }

  const cap = status?.trialMessageCap ?? 5;
  const used = status?.trialMessagesUsed ?? 0;

  return (
    <div className="chat-shell">
      <header className="chat-head">
        <Brand />
        <div className="sp" />
        {user?.role !== "admin" && (status?.hasOwnKey ? (
          <span className="trial-chip byok">Your key · {status.preferredModel?.split("/").pop()}</span>
        ) : (
          <span className="trial-chip">
            <span className="dots">
              {Array.from({ length: cap }).map((_, i) => (
                <i key={i} className={i < used ? "used" : ""} />
              ))}
            </span>
            <span className="chip-full">{Math.max(cap - used, 0)} free left</span>
            <span className="chip-compact">{Math.max(cap - used, 0)}/{cap}</span>
          </span>
        ))}

        {user?.role === "admin" && (
          <button className="icon-btn" title="Admin" onClick={() => nav("/admin")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></svg>
          </button>
        )}
        {user?.role !== "admin" && (
          <button className="icon-btn" title="Account" onClick={() => nav("/account")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 12 0v1" /></svg>
          </button>
        )}
        <button className="icon-btn" title="Sign out" onClick={() => logout().then(() => nav("/"))}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
        </button>
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {walled ? (
          <div className="chat-stream">
            <div className="wall">
              <div className="panel">
                <h2>You've used your {cap} free messages</h2>
                <p>Add your own OpenRouter API key to keep going — you'll pick the model, and usage is unlimited on your key.</p>
                <button className="btn btn-primary" onClick={() => nav("/account")}>Add my OpenRouter key</button>
              </div>
            </div>
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="chat-stream">
            <div className="empty">
              <div className="mk"><Mark size={54} /></div>
              <h2>What do you want to build?</h2>
              <p>Tell me about your page, feature, or backend on E-Stage. I'll ask a couple of questions, then hand you a Genesis-ready prompt.</p>
              <div className="starters">
                {STARTERS.map((s) => (
                  <button key={s} className="starter" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="chat-stream">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="av">{m.role === "assistant" ? "G" : "you"}</div>
                <div className="body">
                  {m.role === "assistant" ? (
                    <AssistantContent text={m.content} />
                  ) : (
                    <div className="bubble">{m.content}</div>
                  )}
                </div>
              </div>
            ))}
            {streaming && (
              <div className="msg assistant">
                <div className="av">G</div>
                <div className="body"><AssistantContent text={streaming} /></div>
              </div>
            )}
            {busy && !streaming && (
              <div className="msg assistant">
                <div className="av">G</div>
                <div className="body"><div className="typing"><i /><i /><i /></div></div>
              </div>
            )}
          </div>
        )}
      </div>

      {!walled && (
        <div className="composer-wrap">
          <div className="composer">
            <textarea
              ref={taRef}
              rows={1}
              placeholder="Describe what you want to build on E-Stage…"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            <button className="send" disabled={busy || !input.trim()} onClick={() => send(input)} title="Send">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

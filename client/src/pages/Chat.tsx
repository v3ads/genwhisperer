import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, type Message, type ChatStatus } from "../lib/api";

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<[hup]|<\/[hup]|<pre|<\/pre)(.+)$/gm, (m) => m.startsWith("<") ? m : `<p>${m}</p>`);
}

export default function Chat() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get<ChatStatus>("/chat/status");
      setStatus(data);
      if (data.trialExhausted && !data.hasOwnKey) setShowUpgrade(true);
    } catch {}
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;
    if (status?.trialExhausted && !status?.hasOwnKey) { setShowUpgrade(true); return; }

    const userMsg: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    // Resize textarea
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }

    let assistantContent = "";
    const assistantIdx = newMessages.length;

    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (response.status === 402) {
        const data = await response.json();
        setMessages(prev => prev.slice(0, -1));
        setShowUpgrade(true);
        setStatus(s => s ? { ...s, trialExhausted: true } : s);
        return;
      }

      if (!response.ok || !response.body) {
        throw new Error("Request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") break;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                assistantContent += delta;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[assistantIdx] = { role: "assistant", content: assistantContent };
                  return updated;
                });
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIdx] = { role: "assistant", content: "Something went wrong. Please try again." };
        return updated;
      });
    } finally {
      setStreaming(false);
      fetchStatus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* Header */}
      <header style={{ padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, background: "var(--text)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "var(--bg)", fontSize: 12, fontWeight: 700 }}>G</span>
          </div>
          <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: "-0.2px" }}>GenWhisperer</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {status && (
            <div style={{ fontSize: 12, color: status.trialExhausted && !status.hasOwnKey ? "var(--warning)" : "var(--text-3)", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 100, padding: "4px 10px" }}>
              {status.hasOwnKey ? "Own key" : `${status.trialMessagesUsed}/${status.trialMessageCap} free`}
            </div>
          )}
          <button onClick={() => navigate("/account")} style={{ fontSize: 12, color: "var(--text-2)", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 12px", transition: "border-color 150ms" }}>Account</button>
          {user?.role === "admin" && (
            <button onClick={() => navigate("/admin")} style={{ fontSize: 12, color: "var(--text-2)", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 12px" }}>Admin</button>
          )}
          <button onClick={logout} style={{ fontSize: 12, color: "var(--text-3)", padding: "5px 12px" }}>Sign out</button>
        </div>
      </header>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 0" }}>
        {messages.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", padding: "0 24px" }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>✨</div>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 10, letterSpacing: "-0.3px" }}>What do you want to build?</h2>
            <p style={{ color: "var(--text-2)", fontSize: 14, maxWidth: 400, lineHeight: 1.6 }}>
              Describe your idea and I'll craft the perfect Genesis prompt for you — with the right tags, structure, and phrasing.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 24, flexWrap: "wrap", justifyContent: "center" }}>
              {["Build a landing page", "Create a product catalog", "Add a blog section", "Set up pixel tracking"].map(s => (
                <button key={s} onClick={() => setInput(s)} style={{ fontSize: 12, color: "var(--text-2)", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 100, padding: "6px 14px", transition: "border-color 150ms, color 150ms" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-hover)"; e.currentTarget.style.color = "var(--text)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-2)"; }}
                >{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: 24 }}>
            {messages.map((msg, i) => (
              <div key={i} className="animate-fade-in" style={{ display: "flex", gap: 12, flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: msg.role === "user" ? "var(--text)" : "var(--bg-3)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 11, fontWeight: 600, color: msg.role === "user" ? "var(--bg)" : "var(--text-2)" }}>
                  {msg.role === "user" ? "U" : "G"}
                </div>
                <div style={{ maxWidth: "80%", background: msg.role === "user" ? "var(--bg-2)" : "transparent", border: msg.role === "user" ? "1px solid var(--border)" : "none", borderRadius: msg.role === "user" ? "var(--radius-lg)" : 0, padding: msg.role === "user" ? "12px 16px" : "4px 0", fontSize: 14, lineHeight: 1.7 }}>
                  {msg.role === "assistant" ? (
                    <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) || (streaming && i === messages.length - 1 ? '<span class="animate-pulse" style="display:inline-block;width:8px;height:14px;background:var(--text-2);border-radius:2px;vertical-align:middle"></span>' : "") }} />
                  ) : (
                    <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Upgrade Banner */}
      {showUpgrade && (
        <div style={{ background: "var(--bg-1)", borderTop: "1px solid var(--border)", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Free trial complete</p>
            <p style={{ fontSize: 13, color: "var(--text-2)" }}>Add your own OpenRouter API key to keep chatting.</p>
          </div>
          <button onClick={() => navigate("/account")} style={{ background: "var(--text)", color: "var(--bg)", padding: "10px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
            Add API key →
          </button>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "12px 20px 20px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ maxWidth: 720, margin: "0 auto", background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", display: "flex", alignItems: "flex-end", gap: 8, padding: "8px 8px 8px 16px", transition: "border-color 150ms" }}
          onFocus={() => {}} >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build in Genesis…"
            rows={1}
            disabled={streaming || (!!status?.trialExhausted && !status?.hasOwnKey)}
            style={{ flex: 1, background: "transparent", border: "none", resize: "none", fontSize: 14, lineHeight: 1.6, color: "var(--text)", outline: "none", padding: "6px 0", maxHeight: 200, overflowY: "auto", boxShadow: "none" }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming || (!!status?.trialExhausted && !status?.hasOwnKey)}
            style={{ width: 36, height: 36, borderRadius: 8, background: !input.trim() || streaming ? "var(--bg-3)" : "var(--text)", color: !input.trim() || streaming ? "var(--text-3)" : "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 150ms, color 150ms", fontSize: 16 }}
          >
            {streaming ? <span className="animate-spin" style={{ display: "inline-block", width: 14, height: 14, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%" }} /> : "↑"}
          </button>
        </div>
        <p style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>Press Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}

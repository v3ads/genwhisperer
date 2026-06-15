import { useState, type ReactNode } from "react";

// All Genesis bracket tags including aliases and structured tools
const TAG_CORE = 'estage-dedicated|backend|dedicated|product list|products|product grid|tracking|pixel|gtm|tag manager|live controls|controls|estage video|estage courses|section|page|app|blog|undo|revert';
const TAG_RE = new RegExp(`\\[(${TAG_CORE})[^\\]]*\\]`, 'gi');

// Regex to detect a Genesis tag ANYWHERE in a line (not only at the start)
const TAG_ANYWHERE_RE = new RegExp(`\\[(${TAG_CORE})\\b`, 'i');

/** Split text into React nodes, highlighting any Genesis tags inline. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  let key = 0;
  while ((m = TAG_RE.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(<span className="t" key={key++}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * Minimal safe markdown renderer for prose paragraphs.
 * Handles:
 *   - Lines that are only "---" or "---..." → rendered as <hr>
 *   - **bold** → <strong> (splits on ** delimiters, no dangerouslySetInnerHTML)
 * Preserves existing Genesis-tag highlighting via renderInline.
 */
function renderParagraph(text: string, key: number): ReactNode {
  // Strip leading/trailing horizontal rule lines
  const trimmed = text.trim();
  if (/^-{3,}$/.test(trimmed)) {
    return <hr key={key} style={{ border: "none", borderTop: "1px solid var(--line)", margin: "6px 0" }} />;
  }

  // Split on **...** to produce bold segments
  const parts = trimmed.split(/\*\*([^*]+)\*\*/g);
  if (parts.length === 1) {
    // No bold — use existing inline tag renderer
    return <p key={key}>{renderInline(trimmed)}</p>;
  }

  const nodes: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      // Plain text segment — still highlight Genesis tags
      if (part) nodes.push(...renderInline(part));
    } else {
      // Bold segment — highlight Genesis tags inside bold too
      nodes.push(<strong key={i}>{renderInline(part)}</strong>);
    }
  });
  return <p key={key}>{nodes}</p>;
}

function CopyBlock({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="promptblock">
      <div className="pb-head"><span className="d" />Paste into Genesis</div>
      <pre>{renderInline(text)}</pre>
      <div className="pb-foot">
        <button
          className={`copy-btn${done ? " done" : ""}`}
          onClick={() => {
            navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          }}
        >
          {done ? "Copied" : "Copy prompt"}
        </button>
      </div>
    </div>
  );
}

/**
 * Prompt detection — in priority order:
 * 1. If a fenced code block (``` ... ```) exists, treat its contents as the prompt.
 * 2. Else, if any line CONTAINS a Genesis bracket tag anywhere in the line, treat
 *    the first such line as the prompt (catches mid-sentence tags like "...as an [app:]...").
 * 3. Else render as plain prose with minimal markdown support.
 */
export function AssistantContent({ text }: { text: string }) {
  const fence = text.match(/```[a-z]*\n?([\s\S]*?)```/i);
  let promptText: string | null = null;
  let rest = text;

  if (fence) {
    // Priority 1: fenced code block — use its contents regardless of whether a tag is present
    // (the backend is now instructed to always fence the prompt)
    promptText = fence[1].trim();
    rest = (text.slice(0, fence.index) + text.slice(fence.index! + fence[0].length)).trim();
  } else {
    // Priority 2: any line that CONTAINS a Genesis tag anywhere
    const lines = text.split("\n");
    const idx = lines.findIndex((l) => TAG_ANYWHERE_RE.test(l));
    if (idx !== -1) {
      promptText = lines[idx].trim();
      rest = [...lines.slice(0, idx), ...lines.slice(idx + 1)].join("\n").trim();
    }
  }

  // Split rest into paragraphs; filter blank lines
  const paragraphs = rest.split(/\n\n+/).filter(Boolean);

  return (
    <>
      {paragraphs.map((p, i) => renderParagraph(p, i))}
      {promptText && <CopyBlock text={promptText} />}
    </>
  );
}

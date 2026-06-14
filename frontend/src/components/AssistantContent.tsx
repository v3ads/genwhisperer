import { useState, type ReactNode } from "react";

const TAG_RE = /\[(estage-dedicated|product list|tracking|section|page|app|blog)[^\]]*\]/gi;

/** Split a message into paragraphs; highlight any Genesis tags inline. */
function renderInline(text: string) {
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
 * A "prompt" is a line/block that begins with a Genesis bracket tag. We pull the
 * first such block out into a copy card, render the rest as prose.
 */
export function AssistantContent({ text }: { text: string }) {
  // find a fenced code block first (``` ... ```), common for the deliverable
  const fence = text.match(/```[a-z]*\n?([\s\S]*?)```/i);
  let promptText: string | null = null;
  let rest = text;

  if (fence && TAG_RE.test(fence[1])) {
    promptText = fence[1].trim();
    rest = (text.slice(0, fence.index) + text.slice(fence.index! + fence[0].length)).trim();
  } else {
    // otherwise: a paragraph that starts with a tag
    const lines = text.split("\n");
    const idx = lines.findIndex((l) => /^\s*\[(estage-dedicated|product list|tracking|section|page|app|blog)/i.test(l));
    if (idx !== -1) {
      promptText = lines[idx].trim();
      rest = [...lines.slice(0, idx), ...lines.slice(idx + 1)].join("\n").trim();
    }
  }

  const paragraphs = rest.split(/\n\n+/).filter(Boolean);

  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i}>{renderInline(p)}</p>
      ))}
      {promptText && <CopyBlock text={promptText} />}
    </>
  );
}

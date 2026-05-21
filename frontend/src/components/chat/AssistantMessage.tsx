import { Link } from "react-router-dom";

interface TextSegment {
  type: "text" | "code" | "link";
  value: string;
  href?: string;
}

/**
 * Parse assistant message text into segments for rendering.
 * - Backtick spans → inline code; if the span looks like a PB record ID (15 alphanum)
 *   we also render it as a clickable link based on context (kits / entities).
 * - Newlines → preserved via whitespace-pre-wrap on the container.
 */
function parseAssistantContent(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const parts = text.split(/(`[^`]+`)/g);
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const inner = part.slice(1, -1);
      if (/^[a-z0-9]{15}$/.test(inner)) {
        segments.push({ type: "link", value: inner, href: `/kits/${inner}` });
      } else {
        segments.push({ type: "code", value: inner });
      }
    } else if (part) {
      segments.push({ type: "text", value: part });
    }
  }
  return segments;
}

export function AssistantMessage({ content }: { content: string }) {
  const segments = parseAssistantContent(content);
  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.type === "link") {
          return (
            <Link
              key={i}
              to={seg.href!}
              className="font-mono text-indigo-300 underline hover:text-indigo-200"
            >
              {seg.value}
            </Link>
          );
        }
        if (seg.type === "code") {
          return (
            <code
              key={i}
              className="font-mono text-xs bg-slate-700 px-1 py-0.5 rounded text-slate-200"
            >
              {seg.value}
            </code>
          );
        }
        return <span key={i}>{seg.value}</span>;
      })}
    </span>
  );
}

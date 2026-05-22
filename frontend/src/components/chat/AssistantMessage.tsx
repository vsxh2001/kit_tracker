interface TextSegment {
  type: "text" | "code";
  value: string;
}

/**
 * Parse assistant message text into segments for rendering.
 * - Backtick spans → inline code (plain, no auto-link).
 * - Auto-linking 15-char alphanumeric IDs to /kits/<id> was removed because PB uses
 *   the same 15-char format for ALL record types (entities, components, requests, users).
 *   Linking blindly to /kits/ caused 404s when the ID belonged to a non-kit record.
 * - Newlines → preserved via whitespace-pre-wrap on the container.
 */
function parseAssistantContent(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const parts = text.split(/(`[^`]+`)/g);
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const inner = part.slice(1, -1);
      segments.push({ type: "code", value: inner });
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

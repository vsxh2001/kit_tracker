import type { ClarificationRequest } from "../../types/ai";

export function ClarificationCard({
  clarification,
  onChoose,
}: {
  clarification: ClarificationRequest;
  onChoose: (id: string, label: string, field: string) => void;
}) {
  return (
    <div
      data-testid="clarification-card"
      className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs mt-1"
    >
      <p className="text-amber-200 font-medium mb-2">
        Multiple matches for <code className="font-mono bg-slate-700 px-1 rounded">{clarification.field}</code>. Pick one:
      </p>
      <div className="flex flex-col gap-1">
        {clarification.candidates.map((c) => (
          <button
            key={c.id}
            data-testid={`clarification-choice-${c.id}`}
            onClick={() => onChoose(c.id, c.label, clarification.field)}
            className="text-left rounded px-2 py-1 bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors"
          >
            <span className="font-medium">{c.label}</span>
            {c.detail && <span className="text-slate-400 ml-1">— {c.detail}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

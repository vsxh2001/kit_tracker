import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Undo2, CheckCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import { toast } from "../ui/use-toast";
import { undoAction } from "../../services/ai";
import type { ToolResult } from "../../types/ai";

const COLLECTION_PATHS: Record<string, string> = {
  entities: "/entities",
  kits: "/kits",
  transactions: "/kits",
};

export function ToolResultCard({
  toolResult,
  undoToken,
  onUndo,
}: {
  toolResult: ToolResult;
  undoToken?: string;
  onUndo?: () => void;
}) {
  const [undone, setUndone] = useState(false);
  const [undoVisible, setUndoVisible] = useState(!!undoToken);
  const [undoing, setUndoing] = useState(false);
  const [countdown, setCountdown] = useState(() => (undoToken ? 60 : 0));

  useEffect(() => {
    if (!undoToken) return;
    const hideTimer = setTimeout(() => setUndoVisible(false), 60_000);
    const ticker = setInterval(() => {
      setCountdown((s) => (s > 1 ? s - 1 : s));
    }, 1000);
    return () => {
      clearTimeout(hideTimer);
      clearInterval(ticker);
    };
  }, [undoToken]);

  const basePath = COLLECTION_PATHS[toolResult.collection] ?? "/";
  const recordPath = `${basePath}/${toolResult.record_id}`;

  async function handleUndo() {
    if (!undoToken || undoing) return;
    setUndoing(true);
    try {
      await undoAction(undoToken);
      setUndone(true);
      setUndoVisible(false);
      onUndo?.();
      toast({ title: "Reverted", description: toolResult.description + " has been reverted.", variant: "success" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not undo action.";
      if (msg === "expired") {
        setUndoVisible(false);
        toast({ title: "Undo window closed", description: "The 60s undo window has elapsed.", variant: "destructive" });
      } else {
        toast({
          title: "Undo failed",
          description: msg,
          variant: "destructive",
        });
      }
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div
      data-testid="tool-result-card"
      className={cn(
        "rounded-lg border px-3 py-2 text-xs mt-1",
        undone
          ? "border-slate-600 bg-slate-800/40 text-slate-500"
          : "border-emerald-700/50 bg-emerald-950/40 text-emerald-200"
      )}
    >
      <div className="flex items-start gap-2">
        <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-400" />
        <div className="flex-1 min-w-0">
          <p className={cn("font-medium", undone && "line-through text-slate-500")}>
            {toolResult.description}
          </p>
          {!undone && (
            <Link
              to={recordPath}
              className="text-indigo-400 underline hover:text-indigo-300 truncate block"
            >
              View record
            </Link>
          )}
          {undone && <p className="text-slate-500 italic">Undone</p>}
        </div>
        {undoVisible && !undone && (
          <button
            data-testid="undo-button"
            onClick={handleUndo}
            disabled={undoing}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors shrink-0",
              "bg-slate-700 text-slate-200 hover:bg-slate-600",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <Undo2 className="h-3 w-3" />
            Undo ({countdown}s)
          </button>
        )}
      </div>
    </div>
  );
}

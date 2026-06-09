import { useEffect, useState, startTransition } from "react";
import { KitQR } from "../components/KitQR";
import { KitTagList } from "../components/KitTagList";
import { listKits } from "../services/kits";
import type { Kit } from "../types";

export function PrintLabelsPage() {
  const [kits, setKits] = useState<Kit[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const all = await listKits();
      setKits(all.filter((k) => k.is_active));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { startTransition(() => load()); }, []);

  return (
    <div className="p-4 print:p-0">
      <div className="flex items-center justify-between mb-4 print:hidden">
        <h1 className="text-xl font-semibold">
          Print kit labels{!loading && ` — ${kits.length} kit${kits.length !== 1 ? "s" : ""}`}
        </h1>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          Print →
        </button>
      </div>

      {loading ? (
        <p className="text-muted-foreground print:hidden">Loading…</p>
      ) : (
        <div className="grid grid-cols-3 gap-4 print:gap-2" data-testid="labels-grid">
          {kits.map((kit) => (
            <div
              key={kit.id}
              className="border rounded p-3 flex flex-col items-center gap-2 break-inside-avoid"
            >
              <KitQR kitId={kit.id} size={128} />
              <p className="font-mono text-sm">{kit.serial}</p>
              <KitTagList tags={kit.tags} className="justify-center" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

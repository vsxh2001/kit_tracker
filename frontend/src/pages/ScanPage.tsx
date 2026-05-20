import { useEffect, useState, startTransition } from "react";
import { useParams, Link } from "react-router-dom";

interface ScanResult {
  serial: string;
  holder: string;
  tags: string;
  notes: string;
}

const PB_URL = import.meta.env.VITE_PB_URL ?? "http://127.0.0.1:8090";

export function ScanPage() {
  const { kitId } = useParams<{ kitId: string }>();
  const [data, setData] = useState<ScanResult | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!kitId) return;
    setLoading(true);
    try {
      const res = await fetch(`${PB_URL}/api/scan/${encodeURIComponent(kitId)}`);
      if (res.status === 404) {
        setNotFound(true);
      } else if (res.ok) {
        const json = await res.json();
        setData(json as ScanResult);
      } else {
        setNotFound(true);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (!err?.isAbort) console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [kitId]);

  const tags = data?.tags
    ? data.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-start px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Header */}
        <p className="text-xs uppercase tracking-widest text-muted-foreground text-center mb-8">
          Kit Tracker
        </p>

        {loading && (
          <p className="text-center text-muted-foreground">Loading…</p>
        )}

        {!loading && notFound && (
          <div className="rounded-xl border bg-card p-8 text-center space-y-2">
            <p className="text-lg font-semibold">Kit not found</p>
            <p className="text-sm text-muted-foreground">
              This kit may be retired or the QR code may be outdated.
            </p>
          </div>
        )}

        {!loading && data && (
          <div className="rounded-xl border bg-card shadow-sm p-8 space-y-6">
            {/* Serial */}
            <div className="text-center">
              <h1
                className="text-4xl font-bold tracking-tight"
                style={{ fontFamily: "Fraunces, serif" }}
              >
                {data.serial}
              </h1>
            </div>

            {/* Holder */}
            {data.holder ? (
              <div className="text-center">
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                  Current holder
                </p>
                <p className="text-xl font-medium">{data.holder}</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                  Current holder
                </p>
                <p className="text-xl text-muted-foreground">Unassigned</p>
              </div>
            )}

            {/* Tags */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Notes */}
            {data.notes && (
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                  Notes
                </p>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {data.notes}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Sign-in link */}
        <p className="text-center text-xs text-muted-foreground mt-8">
          <Link to="/login" className="underline underline-offset-2 hover:text-foreground">
            Sign in
          </Link>{" "}
          to manage kits
        </p>
      </div>
    </div>
  );
}

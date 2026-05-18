import { useEffect, useState, startTransition } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { KitTimeline } from "../components/KitTimeline";
import { KitSnapshotCard } from "../components/KitSnapshotCard";
import { getKit, getKitHistory } from "../services/kits";
import { useAuth } from "../context/AuthContext";
import { ActionsCard } from "../components/kit-detail/ActionsCard";
import { DetailsCard } from "../components/kit-detail/DetailsCard";
import { AttachmentsSection } from "../components/kit-detail/AttachmentsSection";
import { ComponentsTable } from "../components/kit-detail/ComponentsTable";
import { MaintenanceSection } from "../components/kit-detail/MaintenanceSection";
import { KitDetailHeader } from "../components/kit-detail/KitDetailHeader";
import { KitHistoryPanel } from "../components/kit-detail/KitHistoryPanel";
import { DangerZoneCard } from "../components/kit-detail/DangerZoneCard";
import type { Kit, Transaction } from "../types";

export function KitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const at = searchParams.get("at") ?? undefined;
  const today = new Date().toISOString().slice(0, 10);
  const { canTransferKits, canDecideRequests, isAdmin } = useAuth();
  const [kit, setKit] = useState<Kit | null>(null);
  const [latest, setLatest] = useState<Transaction | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!id) return;
    setLoading(true);
    let aborted = false;
    try {
      const [k, h] = await Promise.all([
        getKit(id),
        getKitHistory(id),
      ]);
      setKit(k);
      setHistory(h);
      setLatest(h[0] ?? null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err?.isAbort) { aborted = true; return; }
      console.error(err);
    } finally {
      if (!aborted) setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startTransition(() => load()); }, [id]);

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!kit) return <p>Kit not found.</p>;

  const currentEntity = latest?.expand?.to_entity;

  return (
    <div className="space-y-6">
      <KitDetailHeader kit={kit} />

      {/* Time-machine date picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm font-medium text-muted-foreground shrink-0" htmlFor="kit-at-date">
          View as of
        </label>
        <input
          id="kit-at-date"
          type="date"
          max={today}
          value={at ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            if (val) setSearchParams({ at: val }, { replace: true });
            else setSearchParams({}, { replace: true });
          }}
          className="border border-input rounded-md px-2 py-1 text-sm bg-background"
        />
        {at && (
          <button
            onClick={() => setSearchParams({}, { replace: true })}
            className="text-xs text-indigo-600 hover:underline"
          >
            Now
          </button>
        )}
      </div>

      {/* Snapshot card — shown instead of current-state section when at is set */}
      {at && <KitSnapshotCard kitId={kit.id} atDate={at} />}

      <div className="grid md:grid-cols-2 gap-4">
        <DetailsCard
          kit={kit}
          currentHolder={currentEntity ?? null}
          latestTransaction={latest}
        />

        <ActionsCard
          kit={kit}
          isAdmin={isAdmin}
          currentEntityId={currentEntity?.id}
          currentEntityName={currentEntity?.name}
          onChange={load}
        />
      </div>

      <KitTimeline kitId={kit.id} />

      <KitHistoryPanel kitId={kit.id} kitIsActive={kit.is_active} history={history} />

      <ComponentsTable kitId={kit.id} canEdit={canDecideRequests} canTransferKits={canTransferKits} />

      <MaintenanceSection kitId={kit.id} canEdit={canDecideRequests} />

      <AttachmentsSection kitId={kit.id} isAdmin={canDecideRequests} />

      <DangerZoneCard kit={kit} isAdmin={isAdmin} onDeleted={() => navigate("/kits")} />
    </div>
  );
}

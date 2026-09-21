import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { DESTROY_LABEL, ITEM_TYPE_LABEL, REASON_LABEL, RELEASE_LABEL, useQuarantine, useQuarantineAccess, type QuarantineStatus } from "../../api/quarantine";
import { MoveModal, ResolveModal } from "../../components/quarantine/QuarantineModals";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";

const STATUS_LABEL: Record<QuarantineStatus, string> = { quarantined: "On hold", released: "Released", destroyed: "Removed from stock" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/** One hold: what is held and where, why, the decisions taken so far, and the actions still open. */
export function QuarantineDetailPage() {
  const { id } = useParams();
  const holdId = Number(id);
  const { data: r, isLoading, isError } = useQuarantine(holdId);
  const { mayManage, mayRelease } = useQuarantineAccess();
  const [resolve, setResolve] = useState<"release" | "destroy" | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !r) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const open = r.status === "quarantined";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/quarantine" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
            <ArrowLeft size={12} /> Quarantine
          </Link>
          <h1 className="text-2xl font-semibold">{r.itemLabel}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Hold #{r.id}</span>
            <StatusBadge value={r.status} label={STATUS_LABEL[r.status]} />
            {open && <span>· on hold {r.ageDays} {r.ageDays === 1 ? "day" : "days"}</span>}
          </div>
        </div>
        {open && (
          <div className="flex flex-wrap gap-2">
            {mayManage && (
              <button onClick={() => setMoveOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
                Move
              </button>
            )}
            {mayRelease && (
              <>
                <button onClick={() => setResolve("release")} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                  Release…
                </button>
                <button onClick={() => setResolve("destroy")} className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10">
                  Remove from stock…
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {open && (
        <p className={`flex items-start gap-2 rounded-md border p-2 text-xs ${r.enforced ? "border-border bg-muted/40" : "border-warning/40 bg-warning/10"}`}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {r.enforced ? "The inventory system won't let these units be issued, consumed, scrapped or reserved until this hold is decided." : "This hold is a record only: the system can't stop this item being used. People are expected to follow it."}
        </p>
      )}
      {open && !mayRelease && <p className="text-xs text-muted-foreground">Releasing or removing held material needs an admin or quality manager, and not the person who placed the hold.</p>}

      <div className="rounded-lg border border-border bg-card p-4">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="On hold now">
            {r.quantity}
            {r.unit ? ` ${r.unit}` : ""} <span className="text-xs font-normal text-muted-foreground">of {r.originalQuantity}</span>
          </Field>
          <Field label="What">{ITEM_TYPE_LABEL[r.itemType]}</Field>
          <Field label="Lot">{r.lotNumber ?? "—"}</Field>
          <Field label="Why">{REASON_LABEL[r.reasonCategory]}</Field>
          <Field label="Placed">{when(r.createdAt)}</Field>
          <Field label="Source">{r.sourceType === "receiving_line_item" ? `Receiving line #${r.sourceId}` : (r.sourceType ?? "—")}</Field>
          <Field label="Linked NCR">
            {r.ncrId ? (
              <Link to={`/ncr/${r.ncrId}`} className="text-primary hover:underline">
                NCR #{r.ncrId}
              </Link>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Closed on">{when(r.releasedAt ?? r.destroyedAt)}</Field>
        </dl>
        <p className="mt-3 whitespace-pre-wrap text-sm">{r.reason}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Where it is</h2>
          {r.inventory.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is held any more.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {r.inventory.map((l) => (
                <li key={l.id} className="flex justify-between border-b border-border pb-1">
                  <span>{l.location}</span>
                  <span className="tabular-nums">{l.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Decisions</h2>
          {r.resolutions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decision has been taken yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {r.resolutions.map((d) => (
                <li key={d.id} className="border-b border-border pb-2">
                  <p className="font-medium">
                    {d.action === "release" ? "Released" : "Removed"} {d.quantity} — {(d.action === "release" ? RELEASE_LABEL : DESTROY_LABEL)[d.disposition] ?? d.disposition}
                  </p>
                  <p className="text-xs text-muted-foreground">{when(d.resolvedAt)}</p>
                  <p className="text-xs">{d.notes}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <AttachmentsPanel entityType="quarantine" entityId={holdId} />
      <WorkflowHistoryPanel moduleName="quarantine" recordId={holdId} />

      {resolve && <ResolveModal key={`${resolve}-${r.quantity}`} record={r} action={resolve} isOpen onClose={() => setResolve(null)} />}
      <MoveModal key={`move-${r.inventory.map((i) => `${i.location}${i.quantity}`).join()}`} record={r} isOpen={moveOpen} onClose={() => setMoveOpen(false)} />
    </div>
  );
}

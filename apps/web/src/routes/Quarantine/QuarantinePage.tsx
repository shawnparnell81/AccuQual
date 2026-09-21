import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { REASON_LABEL, useQuarantineAccess, useQuarantineInventory, useQuarantineList, useQuarantineSummary, type QuarantineStatus } from "../../api/quarantine";
import { CreateHoldModal } from "../../components/quarantine/QuarantineModals";
import { StatusBadge } from "../../components/tables/StatusBadge";

const STATUS_LABEL: Record<QuarantineStatus, string> = { quarantined: "On hold", released: "Released", destroyed: "Removed from stock" };

function Card({ label, value, tone }: { label: string; value: number | string; tone?: "warn" | "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : ""}`}>{value}</p>
    </div>
  );
}

/**
 * Quarantine: what is on hold, why, for how long, and where it physically is. Holds on inventory lots and items are enforced
 * by the inventory system (the units can't be issued, consumed, scrapped or reserved until a person decides); other kinds are
 * records, labelled as such.
 */
export function QuarantinePage() {
  const navigate = useNavigate();
  const { mayManage } = useQuarantineAccess();
  const [tab, setTab] = useState<"holds" | "where">("holds");
  const [status, setStatus] = useState<string>("quarantined");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const summary = useQuarantineSummary();
  const list = useQuarantineList({ status: status || undefined, q: q || undefined });
  const where = useQuarantineInventory();
  const s = summary.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Quarantine</h1>
          <p className="text-sm text-muted-foreground">Material and product on hold until someone decides what happens to it.</p>
        </div>
        {mayManage && (
          <button onClick={() => setCreateOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            Place a hold
          </button>
        )}
      </div>

      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Card label="On hold now" value={s.openHolds} />
          <Card label="Enforced by inventory" value={s.enforcedHolds} />
          <Card label="Record only" value={s.notEnforcedHolds} tone={s.notEnforcedHolds > 0 ? "warn" : undefined} />
          <Card label="Held over 7 days" value={s.olderThan7Days} tone={s.olderThan7Days > 0 ? "warn" : undefined} />
          <Card label="Held over 30 days" value={s.olderThan30Days} tone={s.olderThan30Days > 0 ? "bad" : undefined} />
          <Card label="Oldest hold (days)" value={s.oldestDays} />
        </div>
      )}

      <div className="flex gap-1 border-b border-border text-sm">
        {(["holds", "where"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {t === "holds" ? "Holds" : "Where it is"}
          </button>
        ))}
      </div>

      {tab === "holds" ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select className="rounded-md border border-form-field bg-background px-2 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="quarantined">On hold</option>
              <option value="">All</option>
              <option value="released">Released</option>
              <option value="destroyed">Removed from stock</option>
            </select>
            <input className="min-w-48 flex-1 rounded-md border border-form-field bg-background px-2 py-1.5 text-sm" placeholder="Search item, lot or reason…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5">#</th>
                  <th>Item</th>
                  <th>Held now</th>
                  <th>Why</th>
                  <th>Age</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(list.data ?? []).map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/quarantine/${r.id}`)} className="cursor-pointer border-t border-border hover:bg-muted/50">
                    <td className="py-1.5">#{r.id}</td>
                    <td className="font-medium">
                      {r.itemLabel}
                      {!r.enforced && (
                        <span title="The system can't stop this being used" className="ml-2 inline-flex items-center gap-0.5 rounded bg-warning/15 px-1 text-[10px] font-semibold uppercase text-warning">
                          <AlertTriangle size={10} /> record only
                        </span>
                      )}
                    </td>
                    <td className="tabular-nums">
                      {r.quantity}
                      {r.unit ? ` ${r.unit}` : ""}
                    </td>
                    <td className="text-muted-foreground">{REASON_LABEL[r.reasonCategory]}</td>
                    <td className="tabular-nums">{r.status === "quarantined" ? `${r.ageDays} d` : "—"}</td>
                    <td>
                      <StatusBadge value={r.status} label={STATUS_LABEL[r.status]} />
                    </td>
                  </tr>
                ))}
                {list.data && list.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-muted-foreground">
                      Nothing here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-medium">By location</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {(where.data?.byLocation ?? []).map((l) => (
                <li key={l.location} className="flex justify-between border-b border-border pb-1">
                  <span>{l.location}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {l.quantity} in {l.lines} {l.lines === 1 ? "hold" : "holds"}
                  </span>
                </li>
              ))}
              {where.data && where.data.byLocation.length === 0 && <li className="text-muted-foreground">Nothing is on hold.</li>}
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-medium">Held material</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5">Location</th>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {(where.data?.rows ?? []).map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/quarantine/${r.quarantineId}`)} className="cursor-pointer border-t border-border hover:bg-muted/50">
                    <td className="py-1.5">{r.location}</td>
                    <td className="font-medium">{r.itemLabel}</td>
                    <td className="tabular-nums">
                      {r.quantity}
                      {r.unit ? ` ${r.unit}` : ""}
                    </td>
                    <td className="text-muted-foreground">{REASON_LABEL[r.reasonCategory]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateHoldModal isOpen={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

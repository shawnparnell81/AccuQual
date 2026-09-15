import { useState } from "react";
import { Link } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { TextField } from "../../components/forms/Field";
import type { RmaLogEntry } from "../../api/types";

const rmaLogHooks = createResourceHooks<RmaLogEntry>("rma-log");

const EVENT_LABELS: Record<string, string> = {
  request_submitted: "Request Submitted",
  auto_match_attempted: "Auto-Match Attempted",
  rma_created: "RMA Created",
  notifications_sent: "Notifications Sent",
};

/**
 * Read-only event log for every Supplier Portal RMA Request — see
 * rmaRequest.controller.ts's own comment on why each step (submission,
 * part/PO auto-match, real RMA creation, notification) is logged here in
 * addition to the standard audit trail. Quality has full access, Customer
 * Service view-only (see departmentAccess.ts's PERMISSION_MATRIX.rma_log) —
 * both enforced server-side; this page shows the same list to either.
 */
export function RmaLogPage() {
  const [rmaId, setRmaId] = useState("");
  const { data: rows = [], isLoading } = rmaLogHooks.useList(rmaId ? { rmaId } : undefined);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">RMA Log</h1>
      <p className="text-sm text-muted-foreground">Every automated step behind a Supplier Portal RMA Request — submission, part/PO matching, RMA creation, and notifications.</p>

      <div className="w-48">
        <TextField label="Filter by RMA #" type="number" value={rmaId} onChange={(e) => setRmaId(e.target.value)} />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No log entries yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-2">When</th>
              <th className="pb-2">Event</th>
              <th className="pb-2">RMA</th>
              <th className="pb-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="py-1.5 whitespace-nowrap text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="py-1.5 font-medium">{EVENT_LABELS[r.event] ?? r.event}</td>
                <td className="py-1.5">
                  {r.rmaId ? (
                    <Link to={`/rma/${r.rmaId}`} className="text-primary hover:underline">
                      RMA #{r.rmaId}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-1.5 text-muted-foreground">{r.details ? JSON.stringify(r.details) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

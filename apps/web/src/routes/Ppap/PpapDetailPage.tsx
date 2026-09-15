import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { LinkSalesAccountButton } from "../../components/shared/LinkSalesAccountButton";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import type { PpapPackage } from "./PpapListPage";

const ppapHooks = createResourceHooks<PpapPackage>("ppap");

const DOCUMENTS = [
  { formType: "apqp_summary", label: "APQP Summary" },
  { formType: "control_plan", label: "Control Plan" },
  { formType: "dimensional_report", label: "Dimensional Report" },
  { formType: "process_flow_diagram", label: "Process Flow Diagram" },
  { formType: "appearance_approval", label: "Appearance Approval Report" },
  { formType: "dvpr", label: "Design Validation Plan and Report" },
  { formType: "final_inspection_release_checklist", label: "Final Inspection & Release Checklist" },
] as const;

/**
 * A PPAP submission package for one part — every document a real PPAP
 * package travels with, each opening as its own fillable, exportable form
 * scoped to this same package (same entityId, distinct formType).
 */
export function PpapDetailPage() {
  const { id } = useParams();
  const ppapId = Number(id);
  const { data: ppap, isLoading } = ppapHooks.useOne(ppapId);

  if (isLoading || !ppap) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            PPAP #{ppap.id} — {ppap.partNumber}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={ppap.status} />
            {ppap.partName && <span className="text-sm text-muted-foreground">{ppap.partName}</span>}
            {ppap.customer && <span className="text-sm text-muted-foreground">— {ppap.customer}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkSalesAccountButton sourceType="PPAP" sourceId={ppap.id} defaultAccountName={ppap.customer ?? `PPAP #${ppap.id}`} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Package Documents</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DOCUMENTS.map((doc) => (
            <div key={doc.formType} className="flex items-center justify-between rounded-md border border-border p-3">
              <span className="text-sm font-medium">{doc.label}</span>
              <OpenFormButton
                formType={doc.formType}
                entityId={ppap.id}
                title={`PPAP #${ppap.id} — ${doc.label}`}
                label="Open"
              />
            </div>
          ))}
        </div>
      </div>

      <AttachmentsPanel entityType="ppap" entityId={ppap.id} />
    </div>
  );
}

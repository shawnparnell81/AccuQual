import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { PrintFormButton } from "../../components/forms/PrintFormButton";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";

interface Complaint {
  id: number;
  customerName: string | null;
  description: string;
  severity: string | null;
  status: string;
}

const complaintHooks = createResourceHooks<Complaint>("complaints");

/** Complaint detail: the record plus its fillable complaint form. */
export function ComplaintDetailPage() {
  const { id } = useParams();
  const complaintId = Number(id);
  const { data: complaint, isLoading } = complaintHooks.useOne(complaintId);

  if (isLoading || !complaint) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            Complaint #{complaint.id} {complaint.customerName && <span className="text-muted-foreground">— {complaint.customerName}</span>}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={complaint.status} />
            <StatusBadge value={complaint.severity} />
          </div>
        </div>
        <div className="flex gap-2">
          <OpenFormButton formType="complaint" entityId={complaint.id} title={`Complaint #${complaint.id} Form`} />
          <PrintFormButton formType="complaint" entityId={complaint.id} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">{complaint.description}</div>

      <AttachmentsPanel entityType="complaint" entityId={complaint.id} />
    </div>
  );
}

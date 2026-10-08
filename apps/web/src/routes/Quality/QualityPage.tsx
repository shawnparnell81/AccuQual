import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { showRecordNumber } from "../../lib/userRecordNumber";

export interface DiscrepancyInvestigation {
  id: number;
  recordNumber?: string | null;
  title: string;
  severity: string | null;
  status: string;
  autoCreated: boolean;
  sourceAuditId: number | null;
}

/**
 * The Quality folder: Discrepancy & Inspection investigations. Most rows
 * here are opened automatically — any nonconformance (minor/major/critical
 * finding) logged during an internal audit starts one immediately (see
 * services/api's audits.controller.ts addItemHandler) — a user can also
 * start one by hand for anything found outside an audit.
 */
export function QualityPage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<DiscrepancyInvestigation>
      title="Quality"
      resource="quality"
      onRowClick={(d) => navigate(`/quality/${d.id}`)}
      onCreated={(d) => navigate(`/quality/${d.id}`)}
      columns={[
        { header: "Record No.", accessor: (d) => showRecordNumber(d.recordNumber) },
        { header: "Title", accessor: (d) => d.title },
        { header: "Severity", accessor: (d) => <StatusBadge value={d.severity} /> },
        { header: "Status", accessor: (d) => <StatusBadge value={d.status} /> },
        { header: "Source", accessor: (d) => (d.autoCreated ? "Opened from an audit" : "Manual") },
      ]}
      createFields={[
        { name: "recordNumber", label: "Record No." },
        { name: "title", label: "Title" },
        { name: "description", label: "Description" },
        { name: "severity", label: "Severity", type: "select", options: ["minor", "major", "critical"] },
      ]}
    />
  );
}

import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenWindowButton } from "../../components/shared/OpenWindowButton";
import { CurrentPlantNote } from "../../components/layout/CurrentPlantNote";
import { usePlantWrite } from "../../hooks/usePlantWrite";
import type { Audit } from "../../api/types";

export function AuditsPage() {
  const navigate = useNavigate();
  const { canEdit, reason } = usePlantWrite("audit");
  return (
    <div className="flex flex-col gap-2">
    <CurrentPlantNote />
    <ResourceListPage<Audit>
      title="Audits"
      resource="audits"
      canCreate={canEdit}
      accessNote={reason}
      onRowClick={(a) => navigate(`/audits/${a.id}`)}
      onCreated={(a) => navigate(`/audits/${a.id}`)}
      columns={[
        { header: "ID", accessor: (a) => `#${a.id}` },
        { header: "Name", accessor: (a) => a.name },
        { header: "Type", accessor: (a) => a.type ?? "—" },
        { header: "Status", accessor: (a) => <StatusBadge value={a.status} /> },
        { header: "Scheduled", accessor: (a) => (a.scheduledAt ? new Date(a.scheduledAt).toLocaleDateString() : "—") },
        {
          header: "",
          accessor: (a) => <OpenWindowButton type="audit" entityId={a.id} title={`Audit #${a.id} — ${a.name}`} />,
        },
      ]}
      createFields={[
        { name: "name", label: "Audit name" },
        { name: "type", label: "Type", type: "select", options: ["internal", "supplier", "customer", "certification"] },
        { name: "scheduledAt", label: "Scheduled date", type: "date" },
      ]}
    />
    </div>
  );
}

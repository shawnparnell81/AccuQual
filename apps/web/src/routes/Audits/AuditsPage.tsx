import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenWindowButton } from "../../components/shared/OpenWindowButton";
import { CurrentPlantNote } from "../../components/layout/CurrentPlantNote";
import { usePlantWrite } from "../../hooks/usePlantWrite";
import type { Audit } from "../../api/types";
import { showRecordNumber } from "../../lib/userRecordNumber";

export function AuditsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { canEdit, reason } = usePlantWrite("audit");
  const accessPending = !canEdit && reason == null;
  useEffect(() => {
    if (accessPending || params.get("new") !== "1") return;
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  }, [accessPending, params, setParams]);
  return (
    <div className="flex flex-col gap-2">
    <CurrentPlantNote />
    <ResourceListPage<Audit>
      title="Audits"
      resource="audits"
      canCreate={canEdit}
      createOnMount={params.get("new") === "1" && canEdit}
      accessNote={reason}
      onRowClick={(a) => navigate(`/audits/${a.id}`)}
      onCreated={(a) => navigate(`/audits/${a.id}`)}
      columns={[
        { header: "Audit No.", accessor: (a) => showRecordNumber(a.recordNumber) },
        { header: "Name", accessor: (a) => a.name },
        { header: "Type", accessor: (a) => a.type ?? "—" },
        { header: "Status", accessor: (a) => <StatusBadge value={a.status} /> },
        { header: "Scheduled", accessor: (a) => (a.scheduledAt ? new Date(a.scheduledAt).toLocaleDateString() : "—") },
        {
          header: "",
          accessor: (a) => <OpenWindowButton type="audit" entityId={a.id} title={`${showRecordNumber(a.recordNumber) ? `Audit ${showRecordNumber(a.recordNumber)} — ` : "Audit — "}${a.name}`} />,
        },
      ]}
      createFields={[
        { name: "recordNumber", label: "Audit No." },
        { name: "name", label: "Audit name" },
        { name: "type", label: "Type", type: "select", options: ["internal", "supplier", "customer", "certification"] },
        { name: "scheduledAt", label: "Scheduled date", type: "date" },
      ]}
    />
    </div>
  );
}

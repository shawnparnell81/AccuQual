import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";

interface EightDReport {
  id: number;
  ncrId: number | null;
  currentStep: number;
}

export function EightDPage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<EightDReport>
      title="8D reports"
      resource="8d"
      onRowClick={(r) => navigate(`/8d/${r.id}`)}
      onCreated={(r) => navigate(`/8d/${r.id}`)}
      columns={[
        { header: "ID", accessor: (r) => `#${r.id}` },
        { header: "Linked NCR", accessor: (r) => (r.ncrId ? `#${r.ncrId}` : "—") },
        { header: "Current step", accessor: (r) => `D${r.currentStep}` },
      ]}
      createFields={[{ name: "ncrId", label: "Linked NCR ID", type: "number" }]}
    />
  );
}

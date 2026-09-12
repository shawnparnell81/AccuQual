import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";

interface RiskAssessment {
  id: number;
  title: string;
  processArea: string | null;
  status: string;
}

export function RiskPage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<RiskAssessment>
      title="Risk / FMEA"
      resource="risk"
      onRowClick={(r) => navigate(`/risk/${r.id}`)}
      onCreated={(r) => navigate(`/risk/${r.id}`)}
      columns={[
        { header: "ID", accessor: (r) => `#${r.id}` },
        { header: "Title", accessor: (r) => r.title },
        { header: "Process Area", accessor: (r) => r.processArea ?? "—" },
        { header: "Status", accessor: (r) => r.status },
      ]}
      createFields={[
        { name: "title", label: "Title" },
        { name: "processArea", label: "Process area" },
      ]}
    />
  );
}

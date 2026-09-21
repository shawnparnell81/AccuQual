import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { TrainingAttentionStrip } from "../../components/training/TrainingPanels";
import { departmentLabel } from "../../api/training";

interface TrainingCourse {
  id: number;
  title: string;
  description: string | null;
  requiredForDepartment: string | null;
  validityMonths: number | null;
  active: boolean;
}

/** Competency Matrix is a tenant-wide roster of every operator's station qualifications, not tied to one course — so it's a fixed singleton document, same pattern as the Production Logs page. */
const COMPETENCY_MATRIX_ENTITY_ID = 1;

export function TrainingPage() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-medium">Operator Station Competency Matrix</h2>
          <p className="text-sm text-muted-foreground">Every operator's qualification level across every station, with Total Qualification % calculated automatically.</p>
        </div>
        <OpenFormButton formType="competency_matrix" entityId={COMPETENCY_MATRIX_ENTITY_ID} title="Competency Matrix" label="Open Competency Matrix" />
      </div>

      <TrainingAttentionStrip />

      <ResourceListPage<TrainingCourse>
        title="Training"
        resource="training"
        onRowClick={(c) => navigate(`/training/${c.id}`)}
        onCreated={(c) => navigate(`/training/${c.id}`)}
        columns={[
          { header: "ID", accessor: (c) => `#${c.id}` },
          { header: "Course", accessor: (c) => c.title },
          { header: "Description", accessor: (c) => c.description ?? "—" },
          { header: "Required for", accessor: (c) => (c.requiredForDepartment ? departmentLabel(c.requiredForDepartment) : "—") },
          { header: "Valid for", accessor: (c) => (c.validityMonths ? `${c.validityMonths} months` : "Doesn't expire") },
          { header: "", accessor: (c) => (c.active ? "" : "Retired") },
        ]}
        createFields={[
          { name: "title", label: "Course title" },
          { name: "description", label: "Description" },
        ]}
      />
    </div>
  );
}

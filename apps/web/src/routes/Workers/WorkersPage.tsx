import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { useWorkers, EMPLOYMENT_STATUS_LABEL, type WorkerProfile, type EmploymentStatus } from "../../api/workers";

const STATUS_CLASSES: Record<EmploymentStatus, string> = {
  active: "bg-success/15 text-success",
  on_leave: "bg-warning/15 text-warning",
  terminated: "bg-destructive/15 text-destructive",
};

function EmploymentStatusBadge({ status }: { status: EmploymentStatus }) {
  return <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASSES[status])}>{EMPLOYMENT_STATUS_LABEL[status]}</span>;
}

/**
 * Worker Runtime's roster: every internal user of this company, department/role
 * from `users` itself alongside the small profile Worker Runtime adds (job
 * title, shift, employment status). No create button — a worker's account
 * is created the normal way (registration, SSO, an admin); this page only
 * ever edits the profile layered on top of an existing user, from the
 * detail page.
 */
export function WorkersPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading, isError } = useWorkers();

  const columns: Column<WorkerProfile>[] = [
    { header: "Name", accessor: (w) => w.name ?? w.email },
    { header: "Department", accessor: (w) => (w.department ? w.department.replace(/_/g, " ") : "—") },
    { header: "Role", accessor: (w) => w.roleName ?? "—" },
    { header: "Job title", accessor: (w) => w.jobTitle ?? "—" },
    { header: "Shift", accessor: (w) => w.shift ?? "—" },
    { header: "Status", accessor: (w) => <EmploymentStatusBadge status={w.employmentStatus} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Worker Profiles</h1>
      <DataTable<WorkerProfile>
        columns={columns}
        rows={rows}
        rowKey={(w) => w.userId}
        onRowClick={(w) => navigate(`/workers/${w.userId}`)}
        isLoading={isLoading}
        isError={isError}
        emptyMessage="No internal users yet."
      />
    </div>
  );
}

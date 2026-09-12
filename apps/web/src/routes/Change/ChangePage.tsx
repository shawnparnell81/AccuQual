import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";

interface ChangeRequest {
  id: number;
  title: string;
  status: string;
}

const changeHooks = createResourceHooks<ChangeRequest>("change");

export function ChangePage() {
  const navigate = useNavigate();
  const approveAction = changeHooks.useAction("approve");

  return (
    <ResourceListPage<ChangeRequest>
      title="Change Management"
      resource="change"
      onRowClick={(c) => navigate(`/change/${c.id}`)}
      onCreated={(c) => navigate(`/change/${c.id}`)}
      columns={[
        { header: "ID", accessor: (c) => `#${c.id}` },
        { header: "Title", accessor: (c) => c.title },
        { header: "Status", accessor: (c) => <StatusBadge value={c.status} /> },
        {
          header: "Action",
          accessor: (c) =>
            c.status !== "approved" ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  approveAction.mutate({ id: c.id });
                }}
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
              >
                Approve
              </button>
            ) : (
              "—"
            ),
        },
      ]}
      createFields={[
        { name: "title", label: "Title" },
        { name: "description", label: "Description" },
        { name: "impactAssessment", label: "Impact assessment" },
      ]}
    />
  );
}

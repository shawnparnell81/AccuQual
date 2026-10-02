import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenWindowButton } from "../../components/shared/OpenWindowButton";
import type { AccuQualDocument } from "../../api/types";
import { listRevisionLabel } from "../../lib/documentRevision";

/**
 * Document Control. The live register is LST-GEN-001 Master Document List.
 * Document Control Master Index is not offered. Folder browsing stays on Folder Explorer.
 */
export function DocumentsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const includeObsolete = params.get("includeObsolete") === "1";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-medium">Master Document List</h2>
          <p className="text-sm text-muted-foreground">LST-GEN-001. Revision, release date, and status for every controlled document. This list is shared by every plant.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/documents/master-list" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Open Master Document List</Link>
          <Link to="/documents/import" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Import filled form</Link>
        </div>
      </div>

      <ResourceListPage<AccuQualDocument>
        title="Documents"
        resource="documents"
        onRowClick={(d) => navigate(`/documents/${d.id}`)}
        rowPredicate={(d) => includeObsolete || d.status !== "obsolete"}
        extraFilters={
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeObsolete}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.checked) next.set("includeObsolete", "1");
                else next.delete("includeObsolete");
                setParams(next, { replace: true });
              }}
            />
            Include obsolete
          </label>
        }
        columns={[
          { header: "ID", accessor: (d) => `#${d.id}` },
          { header: "Title", accessor: (d) => d.title },
          { header: "Category", accessor: (d) => d.category ?? "—" },
          { header: "Revision", accessor: (d) => listRevisionLabel(d) },
          { header: "Effective", accessor: (d) => (d.effectiveDate ? new Date(d.effectiveDate).toLocaleDateString() : "—") },
          { header: "Expires", accessor: (d) => (d.expirationDate ? new Date(d.expirationDate).toLocaleDateString() : "—") },
          { header: "Status", accessor: (d) => <StatusBadge value={d.status} /> },
          {
            header: "",
            accessor: (d) => <OpenWindowButton type="document" entityId={d.id} title={`Document #${d.id} — ${d.title}`} />,
          },
        ]}
        createFields={[
          { name: "title", label: "Title" },
          { name: "category", label: "Category" },
        ]}
      />
    </div>
  );
}

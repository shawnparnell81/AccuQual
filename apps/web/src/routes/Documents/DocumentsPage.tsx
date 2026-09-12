import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import type { AccuQualDocument } from "../../api/types";

/** A tenant-wide master index of every controlled document, not one document record — a fixed singleton, same pattern as the Production Logs page. */
const DOCUMENT_CONTROL_INDEX_ENTITY_ID = 1;

/**
 * Document Control: the master index + controlled-document register.
 * Folder/taxonomy browsing used to have a shortcut card here too, but that
 * was a second path to the exact same page the nav's "Document Library"
 * dropdown already opens directly (with a department pre-selected, which
 * this shortcut couldn't do) — removed rather than leave two nav routes to
 * one destination.
 */
export function DocumentsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-medium">Document Control Master Index</h2>
          <p className="text-sm text-muted-foreground">Revision level, deployment date, next review date, and control status for every controlled document.</p>
        </div>
        <OpenFormButton formType="document_control_index" entityId={DOCUMENT_CONTROL_INDEX_ENTITY_ID} title="Document Control Master Index" label="Open Master Index" />
      </div>

      <ResourceListPage<AccuQualDocument>
        title="Document Control"
        resource="documents"
        columns={[
          { header: "ID", accessor: (d) => `#${d.id}` },
          { header: "Title", accessor: (d) => d.title },
          { header: "Category", accessor: (d) => d.category ?? "—" },
          { header: "Version", accessor: (d) => `v${d.currentVersion}` },
          { header: "Status", accessor: (d) => <StatusBadge value={d.status} /> },
        ]}
        createFields={[
          { name: "title", label: "Title" },
          { name: "category", label: "Category" },
        ]}
      />
    </div>
  );
}

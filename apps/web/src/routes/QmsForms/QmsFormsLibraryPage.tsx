import { useNavigate } from "react-router-dom";
import { ALL_QMS_DOCUMENTS } from "./allQmsDocuments";

/**
 * The full "ACCUQUAL Forms" batch, all 37 unique documents (see
 * allQmsDocuments.ts's own comment), grouped by the department that owns
 * each one — one click-to-open catalog covering both the 22 generic-engine
 * form types AND the 15 that reuse an already-real module (NCR, CAPA, Risk,
 * Audits, Calibration, Training, Complaints, Change, Work Orders, DCR),
 * rather than only listing the generic ones.
 */
export function QmsFormsLibraryPage() {
  const navigate = useNavigate();

  const byDepartment = new Map<string, typeof ALL_QMS_DOCUMENTS>();
  for (const doc of ALL_QMS_DOCUMENTS) {
    byDepartment.set(doc.department, [...(byDepartment.get(doc.department) ?? []), doc]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">QMS Forms</h1>
        <p className="text-sm text-muted-foreground">
          All {ALL_QMS_DOCUMENTS.length} controlled QMS documents, grouped by the department that owns them — also reachable from their own folder in Document Library.
        </p>
      </div>

      {[...byDepartment.entries()].map(([dept, docs]) => (
        <div key={dept} className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">{dept}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {docs.map((doc) => (
              <button
                key={doc.title}
                onClick={() => navigate(doc.route)}
                className="flex items-start justify-between gap-2 rounded-md border border-border p-3 text-left text-sm hover:bg-muted"
                title={doc.isGeneric ? "QMS Forms engine" : "Opens in its own real module"}
              >
                <span className="font-medium">{doc.title}</span>
                {!doc.isGeneric && <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Module</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

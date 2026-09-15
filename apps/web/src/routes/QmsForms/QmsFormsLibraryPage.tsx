import { useNavigate } from "react-router-dom";
import { QMS_FORM_DEFINITIONS } from "./qmsFormDefinitions";

/** Landing page for the generic "ACCUQUAL Forms" batch — every form type grouped by the department that owns it, matching each one's real Document Folders location (see qmsFormDefinitions.ts's folderPath). */
export function QmsFormsLibraryPage() {
  const navigate = useNavigate();

  const byDepartment = new Map<string, typeof QMS_FORM_DEFINITIONS>();
  for (const def of QMS_FORM_DEFINITIONS) {
    const dept = def.folderPath[0];
    byDepartment.set(dept, [...(byDepartment.get(dept) ?? []), def]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">QMS Forms</h1>
        <p className="text-sm text-muted-foreground">Every controlled QMS form, grouped by the department that owns it — also reachable from its own folder in Document Library.</p>
      </div>

      {[...byDepartment.entries()].map(([dept, defs]) => (
        <div key={dept} className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">{dept}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {defs.map((def) => (
              <button
                key={def.formType}
                onClick={() => navigate(`/qms-forms/${def.formType}`)}
                className="rounded-md border border-border p-3 text-left text-sm hover:bg-muted"
                title={def.folderPath.join(" › ")}
              >
                <div className="font-medium">{def.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{def.folderPath[1]} › {def.folderPath[2]}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

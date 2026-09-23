import { X } from "lucide-react";
import { controlledDocumentLabel, labelForRequiredDocument, useControlledDocuments } from "../../api/documents";

const fieldClass = "w-full rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

/**
 * Multi-select for feasibilitySettings.requiredDocuments. Picks existing
 * controlled documents (GET /documents) by id — it does not upload files
 * or invent document names. Already-selected ids are left out of the
 * dropdown; choosing one appends it. Persistence is the settings panel's
 * existing Save action.
 */
export function FeasibilityDocumentSelector({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const { data: documents = [], isLoading, isError } = useControlledDocuments();
  const selected = new Set(value);
  const catalog = documents.filter((doc) => !doc.isDeleted);
  const available = catalog.filter((doc) => !selected.has(String(doc.id)));
  const placeholder = isLoading
    ? "Loading documents…"
    : isError
      ? "Couldn't load documents"
      : catalog.length === 0
        ? "No documents available"
        : available.length === 0
          ? "All documents added"
          : "Add a document…";

  function add(id: string) {
    if (!id || selected.has(id)) return;
    onChange([...value, id]);
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-medium">Required Documents</span>
        <select
          value=""
          onChange={(e) => add(e.target.value)}
          disabled={isLoading || available.length === 0}
          className={fieldClass}
        >
          <option value="">{placeholder}</option>
          {available.map((doc) => (
            <option key={doc.id} value={String(doc.id)}>
              {controlledDocumentLabel(doc)}
            </option>
          ))}
        </select>
      </label>

      {isError && <p className="text-xs text-destructive">Couldn't load the document list.</p>}

      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">Add documents that must be attached before a feasibility review can be completed.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {value.map((id) => {
            const label = labelForRequiredDocument(id, documents);
            return (
              <span key={id} className="flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs">
                {label}
                <button type="button" onClick={() => onChange(value.filter((d) => d !== id))} aria-label={`Remove ${label}`} className="text-muted-foreground hover:text-destructive">
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

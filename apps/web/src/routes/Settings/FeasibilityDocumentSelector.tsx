import { useState } from "react";
import { X } from "lucide-react";

/** Tag-list editor for feasibilitySettings.requiredDocuments — a checklist of document names, not a file upload (see feasibility.ts's own schema comment on providedDocuments for why). */
export function FeasibilityDocumentSelector({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [draft, setDraft] = useState("");

  function add() {
    const name = draft.trim();
    if (!name || value.includes(name)) return;
    onChange([...value, name]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="font-medium">Required Documents</span>
      <div className="flex flex-wrap gap-2">
        {value.length === 0 && <span className="text-xs text-muted-foreground">None required — every review can submit as-is.</span>}
        {value.map((doc) => (
          <span key={doc} className="flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs">
            {doc}
            <button type="button" onClick={() => onChange(value.filter((d) => d !== doc))} aria-label={`Remove ${doc}`} className="text-muted-foreground hover:text-destructive">
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="e.g. Customer Drawing, PPAP Package"
          className="w-full rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        <button type="button" onClick={add} className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
          Add
        </button>
      </div>
      <p className="text-xs text-muted-foreground">A reviewer checks each of these off (Feasibility Review detail page) before a review can be submitted.</p>
    </div>
  );
}

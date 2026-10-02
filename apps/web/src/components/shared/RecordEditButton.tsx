import { Pencil } from "lucide-react";

/** The Edit control used on master lists and forms. */
export function RecordEditButton({ editing, onClick }: { editing: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="record-edit"
      aria-pressed={editing}
      title={editing ? "Done editing" : "Edit"}
      onClick={onClick}
      className={`no-print inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm ${editing ? "border-primary bg-primary/10 text-foreground" : "border-border hover:bg-muted"}`}
    >
      <Pencil size={14} aria-hidden />
      Edit
    </button>
  );
}

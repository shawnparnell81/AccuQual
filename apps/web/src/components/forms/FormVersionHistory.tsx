import { useState } from "react";
import { useFormHistory } from "../../api/formHooks";

interface FormVersionHistoryProps {
  formType: string;
  entityId: number;
}

/** Version list sidebar — view-only (no rollback yet, see README TODOs). */
export function FormVersionHistory({ formType, entityId }: FormVersionHistoryProps) {
  const { data: versions = [], isLoading } = useFormHistory(formType, entityId);
  const [expanded, setExpanded] = useState<number | null>(null);

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading history…</p>;
  if (versions.length === 0) return <p className="text-xs text-muted-foreground">No saved versions yet — use "Save version" below.</p>;

  return (
    <ul className="flex flex-col gap-2 text-xs">
      {versions.map((v) => (
        <li key={v.id} className="rounded border border-border p-2">
          <button className="flex w-full items-center justify-between" onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
            <span className="font-medium">Version {v.version}</span>
            <span className="text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</span>
          </button>
          {expanded === v.id && (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-2">{JSON.stringify(v.data, null, 2)}</pre>
          )}
        </li>
      ))}
    </ul>
  );
}

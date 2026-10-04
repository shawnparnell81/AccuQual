import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

interface PreviousRow {
  id: number;
  number: string;
  status: string;
}

/**
 * Pick an earlier record for this part and open a new one from its setup.
 * The server leaves results, signatures, and history on the source.
 */
export function CopyFromPrevious({
  partNumber,
  previousPath,
  copyPath,
  extraParams,
  onCopied,
}: {
  partNumber: string;
  previousPath: string;
  copyPath: string;
  extraParams?: Record<string, string>;
  onCopied: (created: { id: number }) => void;
}) {
  const part = partNumber.trim();
  const [sourceId, setSourceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: [previousPath, part, extraParams],
    queryFn: async () => (await apiClient.get<PreviousRow[]>(previousPath, { params: { partNumber: part, ...extraParams } })).data,
    enabled: part.length > 0,
  });
  const copy = useMutation({
    mutationFn: async () => (await apiClient.post<{ id: number }>(copyPath, { sourceId: Number(sourceId) })).data,
    onSuccess: (created) => {
      setError(null);
      onCopied(created);
    },
    onError: (err) => setError(extractErrorMessage(err, "The record could not be copied.")),
  });
  if (!part) return null;
  const rows = list.data ?? [];
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>Copy from previous</span>
          <select className="rounded-md border border-border bg-background p-2" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            <option value="">{list.isLoading ? "Looking up records…" : "Select a record"}</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>{row.number} · {row.status}</option>
            ))}
          </select>
        </label>
        <button type="button" className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-60" disabled={!sourceId || copy.isPending} onClick={() => copy.mutate()}>
          {copy.isPending ? "Copying…" : "Copy setup"}
        </button>
      </div>
      {!list.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">No earlier record for this part.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

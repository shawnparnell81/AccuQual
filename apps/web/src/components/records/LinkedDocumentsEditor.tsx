import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import type { AccuQualDocument } from "../../api/types";
import type { LinkedDocumentRef } from "../../lib/stepDocuments";

/**
 * Pick a published document already in Document Control. Who can change the
 * list is the caller's existing canEdit flag — this control does not invent one.
 */
export function LinkedDocumentsEditor({
  documents,
  canEdit,
  onChange,
  busy = false,
}: {
  documents: LinkedDocumentRef[];
  canEdit: boolean;
  onChange: (next: LinkedDocumentRef[]) => void;
  busy?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const catalog = useQuery({
    queryKey: ["documents", "published-for-link"],
    queryFn: async () => (await apiClient.get<AccuQualDocument[]>("/documents")).data,
    enabled: open,
    staleTime: 30_000,
  });

  const needle = query.trim().toLowerCase();
  const choices = useMemo(() => {
    const linked = new Set(documents.map((item) => item.id));
    return (catalog.data ?? [])
      .filter((doc) => doc.status === "approved" && !linked.has(doc.id))
      .filter((doc) => !needle || `${doc.title} ${doc.revisionCode ?? ""}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [catalog.data, documents, needle]);

  return (
    <div className="flex flex-col gap-2">
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No published document is linked on this step.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-2">
              <Link to={`/documents/${doc.id}`} className="min-w-0 truncate text-primary hover:underline">
                {doc.title}
              </Link>
              {canEdit && (
                <button
                  type="button"
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  disabled={busy}
                  onClick={() => onChange(documents.filter((item) => item.id !== doc.id))}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="relative">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Link existing"
            aria-label="Link existing published document"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          {open && (
            <ul className="aq-menu absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-card p-1 text-sm text-foreground shadow-lg">
              {catalog.isLoading && <li className="px-2 py-1 text-xs text-muted-foreground">Loading published documents…</li>}
              {catalog.isError && <li className="px-2 py-1 text-xs text-destructive">Couldn't load Document Control.</li>}
              {!catalog.isLoading && choices.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">No published document matches.</li>}
              {choices.map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    className="w-full truncate rounded px-2 py-1 text-left hover:bg-muted"
                    onClick={() => {
                      onChange([...documents, { id: doc.id, title: doc.title }]);
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    {doc.title}
                    {doc.revisionCode ? ` · ${doc.revisionCode}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

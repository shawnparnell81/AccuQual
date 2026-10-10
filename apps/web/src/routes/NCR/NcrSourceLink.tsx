import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

interface SourceHit {
  kind: "validation" | "iso" | "qms";
  id: number;
  recordNumber: string;
  title: string;
  path: string;
}

/** Search validation reports and forms by number, then store that record as this NCR's source. */
export function NcrSourceLink({
  ncrId,
  canEdit,
  source,
}: {
  ncrId: number;
  canEdit: boolean;
  source: { path?: string; formTitle?: string; recordNumber?: string } | null;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const term = query.trim();
  const results = useQuery({
    queryKey: ["ncr-source-records", term],
    queryFn: async () => (await apiClient.get<SourceHit[]>("/ncr/source-records", { params: { q: term } })).data,
    enabled: open && term.length >= 2,
  });
  const link = useMutation({
    mutationFn: async (hit: SourceHit) => (await apiClient.post(`/ncr/${ncrId}/source-link`, { kind: hit.kind, id: hit.id })).data,
    onSuccess: async (row) => {
      await queryClient.cancelQueries({ queryKey: ["ncr", ncrId] });
      queryClient.setQueryData(["ncr", ncrId], row);
      setQuery("");
      setOpen(false);
      toast.success("Linked to that record.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't link that record.")),
  });

  return (
    <div className="flex flex-col gap-2">
      {source?.path && (
        <Link to={source.path} className="text-sm text-primary hover:underline" data-testid="validation-source">
          Opened from {source.formTitle || source.recordNumber || "the source record"}
        </Link>
      )}
      {canEdit && (
        <div className="relative">
          <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setOpen((value) => !value)} data-testid="link-existing">
            Link existing
          </button>
          {open && (
            <div className="mt-2 flex flex-col gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by form number, for example DEMO-CSA-002"
                aria-label="Link existing record by number"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
              {term.length >= 2 && results.isLoading && <p className="text-xs text-muted-foreground">Searching…</p>}
              {term.length >= 2 && results.isError && <p className="text-xs text-destructive">Couldn't search records. Try again.</p>}
              {term.length >= 2 && results.data && results.data.length === 0 && <p className="text-xs text-muted-foreground">No validation report or form with that number.</p>}
              {results.data && results.data.length > 0 && (
                <ul className="max-h-40 overflow-auto rounded-md border border-border">
                  {results.data.map((hit) => (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <button
                        type="button"
                        disabled={link.isPending}
                        className="w-full px-2 py-1 text-left text-sm hover:bg-muted disabled:opacity-60"
                        onClick={() => link.mutate(hit)}
                      >
                        {hit.recordNumber || hit.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

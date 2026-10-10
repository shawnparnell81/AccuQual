import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useSites } from "../../hooks/useSites";
import { plantSelectOptions } from "../../lib/plantOptions";

interface RecordSite {
  siteId: number | null;
  siteName: string;
}

/** Plant on a saved record. New records already take the working plant. Changing it is audited. */
export function RecordSiteField({ entity, id, canEdit }: { entity: string; id: number; canEdit: boolean }) {
  const { data: plants } = useSites();
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: ["record-site", entity, id],
    queryFn: async () => (await apiClient.get<RecordSite>("/sites/record", { params: { entity, id } })).data,
    enabled: Number.isInteger(id) && id > 0,
  });
  const save = useMutation({
    mutationFn: async (siteId: number) => (await apiClient.patch<RecordSite>("/sites/record", { entity, id, siteId })).data,
    onSuccess: (data) => {
      queryClient.setQueryData(["record-site", entity, id], data);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't change the plant.")),
  });

  if (!query.data) return null;
  const name = query.data.siteName || "Unassigned";
  const choices = plantSelectOptions(plants?.sites ?? [], query.data);
  if (!canEdit || choices.length === 0) {
    return (
      <p className="truncate text-xs text-muted-foreground" title={name} data-print-site={name}>
        Plant: {name}
      </p>
    );
  }

  return (
    <label className="mt-1 flex max-w-xs flex-col gap-1 text-xs text-muted-foreground" data-print-site={name}>
      <span>Plant</span>
      <select
        aria-label="Plant"
        title={name}
        className="truncate rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        value={query.data.siteId == null ? "" : String(query.data.siteId)}
        disabled={save.isPending}
        onChange={(e) => {
          const siteId = Number(e.target.value);
          if (siteId) save.mutate(siteId);
        }}
      >
        {query.data.siteId == null && <option value="">Unassigned</option>}
        {choices.map((site) => (
          <option key={site.value} value={site.value} title={site.title}>
            {site.label}
          </option>
        ))}
      </select>
    </label>
  );
}

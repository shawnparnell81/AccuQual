import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField } from "../../components/forms/Field";

interface SupplierSettings {
  id: number;
  name: string;
  contactEmail: string | null;
}

/** A minimal, real field set (contactEmail) directly on the existing suppliers row — see supplierPortal.controller.ts's own comment on why this isn't a second parallel settings table for one field. */
export function SupplierSettingsPanel({ supplierId }: { supplierId?: number }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["supplier-portal/settings", supplierId ?? "self"];
  const { data, isLoading } = useQuery<SupplierSettings>({
    queryKey,
    queryFn: async () => (await apiClient.get("/supplier-portal/settings", { params: supplierId ? { supplierId } : undefined })).data,
  });
  const [contactEmail, setContactEmail] = useState("");

  useEffect(() => {
    if (data) setContactEmail(data.contactEmail ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: async () => (await apiClient.post("/supplier-portal/settings", { supplierId, contactEmail })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Settings saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save these settings.")),
  });

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium">{data.name} — Settings</h3>
      <TextField label="Contact Email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
      <button onClick={() => save.mutate()} disabled={save.isPending} className="self-start rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {save.isPending ? "Saving…" : "Save Settings"}
      </button>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

export interface NotificationPreferences {
  inApp: boolean;
  email: boolean;
}

export function NotificationPreferencesSection({ mode }: { mode: "inApp" | "email" }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<NotificationPreferences>({
    queryKey: ["notifications/preferences"],
    queryFn: async () => (await apiClient.get("/notifications/me/preferences")).data,
  });
  const save = useMutation({
    mutationFn: async (patch: Partial<NotificationPreferences>) => (await apiClient.patch<NotificationPreferences>("/notifications/me/preferences", patch)).data,
    onSuccess: (next) => {
      queryClient.setQueryData(["notifications/preferences"], next);
      queryClient.invalidateQueries({ queryKey: ["notifications/me"] });
      toast.success("Notification preference saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save that preference.")),
  });

  if (isLoading || !data) return <LoadingPlaceholder />;

  if (mode === "inApp") {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium">In-app notifications</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Training, calibration, and workflow events show up on the bell. Turning this off hides them for you only. It does not stop the company from recording that a notice was sent.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={data.inApp} disabled={save.isPending} onChange={(e) => save.mutate({ inApp: e.target.checked })} />
          Show notifications in AccuQual
        </label>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium">Email alerts</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        AccuQual already sends email for calibration and training digests and for workflow notices, through the company's mail connection. This switch is yours: leave it on to receive those messages, or turn it off to keep them in the app only. Password resets still go to your email either way.
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={data.email} disabled={save.isPending} onChange={(e) => save.mutate({ email: e.target.checked })} />
        Email me these alerts
      </label>
    </section>
  );
}

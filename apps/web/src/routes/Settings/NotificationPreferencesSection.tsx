import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

export interface NotificationPreferences {
  inApp: boolean;
  email: boolean;
  dailyDigest: boolean;
  /** ready: the server has a mail connection. log_only: alerts are stored and not sent. */
  emailDelivery?: "ready" | "log_only";
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
        {data.emailDelivery === "ready"
          ? "Email delivery is connected. Calibration, training, and workflow notices can leave this server. This switch is yours: leave it on to receive those messages, or turn it off to keep them in the app only."
          : "Email delivery is not connected on this server, so alerts are recorded in AccuQual and are not sent. The switch still saves your preference for when mail is connected."}{" "}
        Password resets still try your email either way.
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={data.email} disabled={save.isPending} onChange={(e) => save.mutate({ email: e.target.checked })} />
        Email me these alerts
      </label>
      <div className="mt-4 border-t border-border pt-4">
        <h3 className="text-sm font-medium">Daily digest</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Once a day, email a list of your overdue and due-soon NCRs, CAPAs, and 8Ds, plus approvals waiting on you. Each line links straight to the record. Turning this off does not stop individual reminders.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={data.dailyDigest !== false} disabled={save.isPending || !data.email} onChange={(e) => save.mutate({ dailyDigest: e.target.checked })} />
          Email me a daily digest
        </label>
        {!data.email && <p className="mt-2 text-xs text-muted-foreground">Turn email alerts on to receive the digest.</p>}
      </div>
    </section>
  );
}

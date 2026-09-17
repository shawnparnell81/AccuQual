import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { TextField } from "../../components/forms/Field";
import type { TenantProfile } from "../../api/types";

function useTenantProfile() {
  return useQuery<TenantProfile>({ queryKey: ["tenant/profile"], queryFn: async () => (await apiClient.get("/tenant/profile")).data });
}

/**
 * Phase 10 — a real, editable "Tenant Settings" (name/logo/timezone/contact
 * info), genuinely new: before this, Settings' own "Tenant Settings" tab was
 * read-only and pointed admins at Platform Administration for edits, but
 * that page has no branding/name editor at all (it's cross-tenant
 * provisioning only) — a real dead end this fixes. `name` and `logoUrl`
 * reuse the existing tenants.name column / branding.logoUrl field (not a
 * duplicate store) via the new GET/PATCH /tenant/profile endpoint; the full
 * color palette still lives at Tenant Branding, linked below rather than
 * duplicated here.
 */
export function AdminTenantSettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useTenantProfile();
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [timezone, setTimezone] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setLogoUrl(profile.logoUrl ?? "");
      setTimezone(profile.timezone ?? "");
      setContactName(profile.contactName ?? "");
      setContactEmail(profile.contactEmail ?? "");
      setContactPhone(profile.contactPhone ?? "");
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => (await apiClient.patch("/tenant/profile", { name, logoUrl, timezone, contactName, contactEmail, contactPhone })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant/profile"] });
      toast.success("Tenant settings saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save tenant settings.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Tenant Settings</h1>
        {profile && <p className="text-sm text-muted-foreground">Tenant code: {profile.code}</p>}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <AdminOnlyGuard>
          <form
            className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <TextField label="Organization Name" required value={name} onChange={(e) => setName(e.target.value)} />
            <TextField label="Logo URL" placeholder="https://…" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
            <TextField label="Timezone" placeholder="America/New_York" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label="Contact Name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              <TextField label="Contact Email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
              <TextField label="Contact Phone" type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Full color palette and PDF header/footer branding are configured on the{" "}
              <Link to="/admin/tenant-branding" className="text-primary hover:underline">
                Tenant Branding
              </Link>{" "}
              page.
            </p>
            <button type="submit" disabled={save.isPending} className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60">
              {save.isPending ? "Saving…" : "Save Tenant Settings"}
            </button>
          </form>
        </AdminOnlyGuard>
      )}
    </div>
  );
}

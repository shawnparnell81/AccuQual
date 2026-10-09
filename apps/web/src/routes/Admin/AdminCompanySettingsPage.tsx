import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { TextField, SelectField } from "../../components/forms/Field";
import type { CompanyProfile } from "../../api/types";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

function useCompanyProfile() {
  return useQuery<CompanyProfile>({ queryKey: ["company/profile"], queryFn: async () => (await apiClient.get("/company/profile")).data });
}

/**
 * a real, editable "Company Settings" (name/logo/timezone/contact
 * info), genuinely new: before this, Settings' own "Company Settings" tab was
 * read-only and pointed admins at Platform Administration for edits, but
 * that page has no branding/name editor at all (it's cross-company
 * provisioning only) — a real dead end this fixes. `name` and `logoUrl`
 * reuse the existing company.name column / branding.logoUrl field (not a
 * duplicate store) via the new GET/PATCH /company/profile endpoint; the full
 * color palette still lives at Company Branding, linked below rather than
 * duplicated here.
 */
export function AdminCompanySettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useCompanyProfile();
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

  const { data: security } = useQuery<{ mfaPolicy: "optional" | "admins" | "all"; sessionLengthHours: number }>({ queryKey: ["company/security"], queryFn: async () => (await apiClient.get("/company/security")).data });
  const [sessionHours, setSessionHours] = useState("12");
  useEffect(() => {
    if (security?.sessionLengthHours) setSessionHours(String(security.sessionLengthHours));
  }, [security]);
  const saveSecurity = useMutation({
    mutationFn: async (mfaPolicy: string) => (await apiClient.patch("/company/security", { mfaPolicy })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company/security"] });
      toast.success("Sign-in security policy saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save the policy.")),
  });
  const [navigationLayout, setNavigationLayout] = useState<"sidebar" | "top">("sidebar");
  useEffect(() => {
    setNavigationLayout(profile?.navigationLayout === "top" ? "top" : "sidebar");
  }, [profile?.navigationLayout]);
  const saveNavigationLayout = useMutation({
    mutationFn: async (next: "sidebar" | "top") => (await apiClient.patch("/company/profile", { navigationLayout: next })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company/profile"] });
      toast.success("Navigation layout saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save the navigation layout.")),
  });
  const saveSessionLength = useMutation({
    mutationFn: async (sessionLengthHours: number) => (await apiClient.patch("/company/security", { sessionLengthHours })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company/security"] });
      toast.success("Session length saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save the session length.")),
  });

  const save = useMutation({
    mutationFn: async () => (await apiClient.patch("/company/profile", { name, logoUrl, timezone, contactName, contactEmail, contactPhone })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company/profile"] });
      toast.success("Company settings saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save company settings.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Company Settings</h1>
        {profile && <p className="text-sm text-muted-foreground">Company code: {profile.code}</p>}
      </div>

      {isLoading ? (
        <LoadingPlaceholder />
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
              <Link to="/admin/company-branding" className="text-primary hover:underline">
                Company Branding
              </Link>{" "}
              page.
            </p>
            <button type="submit" disabled={save.isPending} className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60">
              {save.isPending ? "Saving…" : "Save Company Settings"}
            </button>
          </form>

          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-medium">Navigation layout</h2>
            <SelectField label="Navigation layout: Sidebar / Top bar" value={navigationLayout} onChange={(e) => setNavigationLayout(e.target.value === "top" ? "top" : "sidebar")} disabled={saveNavigationLayout.isPending}>
              <option value="sidebar">Sidebar</option>
              <option value="top">Top bar</option>
            </SelectField>
            <p className="text-xs text-muted-foreground">
              Sidebar keeps the menu on the left. Top bar moves the same menu across the top, including Blank Forms, Folders, Settings, and Admin, and lets each page use the full width. Sidebar is the default.
            </p>
            <button
              type="button"
              disabled={saveNavigationLayout.isPending}
              onClick={() => saveNavigationLayout.mutate(navigationLayout)}
              className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60"
            >
              {saveNavigationLayout.isPending ? "Saving…" : "Save navigation layout"}
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-medium">Sign-in security</h2>
            <SelectField label="Who must use two-step sign-in (authenticator app)?" value={security?.mfaPolicy ?? "admins"} onChange={(e) => saveSecurity.mutate(e.target.value)} disabled={saveSecurity.isPending}>
              <option value="optional">Nobody is required (users may opt in)</option>
              <option value="admins">Administrators (recommended)</option>
              <option value="all">Everyone in this organization</option>
            </SelectField>
            <p className="text-xs text-muted-foreground">
              People newly covered have 7 days to set it up before they're asked at sign-in. An admin can reset a user's two-step sign-in from Users &amp; Roles if they lose their phone.
            </p>
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
              <h3 className="text-sm font-medium text-foreground">Session length</h3>
              <SelectField label="How long everyone stays signed in" value={sessionHours} onChange={(e) => setSessionHours(e.target.value)} disabled={saveSessionLength.isPending}>
                {Array.from({ length: 24 }, (_, index) => {
                  const hours = index + 1;
                  return (
                    <option key={hours} value={String(hours)}>
                      {hours} {hours === 1 ? "hour" : "hours"}
                      {hours === 12 ? " (default)" : ""}
                    </option>
                  );
                })}
              </SelectField>
              <p className="text-xs text-muted-foreground">
                This applies to every role. A person stays signed in for this long after they sign in, whether they are using the app or not. Signing out ends it sooner. New sign-ins use the length saved here. A sign-in that is already open keeps the time it has left, unless that is longer than this.
              </p>
              <button
                type="button"
                disabled={saveSessionLength.isPending}
                onClick={() => saveSessionLength.mutate(Number(sessionHours))}
                className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60"
              >
                {saveSessionLength.isPending ? "Saving…" : "Save session length"}
              </button>
            </div>
          </div>
        </AdminOnlyGuard>
      )}
    </div>
  );
}

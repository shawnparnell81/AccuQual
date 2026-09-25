import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { TextField, TextAreaField } from "../../components/forms/Field";
import type { TenantBranding } from "../../api/types";

function useBranding() {
  return useQuery<TenantBranding>({ queryKey: ["tenant/branding"], queryFn: async () => (await apiClient.get("/company/branding")).data });
}

const EMPTY_FORM: TenantBranding = {
  logoUrl: "",
  primaryColor: "#3b82f6",
  pdfHeader: "",
  pdfFooter: "",
  secondaryColor: "",
  accentColor: "",
  backgroundLight: "",
  backgroundDark: "",
  textLight: "",
  textDark: "",
  formFieldColor: "",
  buttonColor: "",
  borderColor: "",
};

function ColorField({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={value || "#000000"} onChange={(e) => onChange(e.target.value)} className="h-9 w-14 rounded border border-border bg-background" />
        <TextField label="" placeholder="Using built-in default" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      </div>
    </label>
  );
}

/**
 * Not the JSON-schema form engine — this is a live-bound settings form
 * prefilled from the tenant's actual current branding, the same kind of
 * page every other module's real settings editing already is (Security &
 * Roles, item/supplier linking), not a fixed-schema printable document.
 *
 * The theme colors below are the same `branding` object as logo/PDF text,
 * not a separate "/admin/tenant-theme" endpoint or page — they're one
 * config a tenant admin edits together (see tenants.branding's schema
 * comment), so this one page grew a "Theme Colors" section rather than
 * forking a second page over the exact same data.
 */
function BrandingForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: branding, isLoading } = useBranding();
  const [form, setForm] = useState<TenantBranding>(EMPTY_FORM);

  useEffect(() => {
    if (branding) setForm({ ...EMPTY_FORM, ...branding });
  }, [branding]);

  const save = useMutation({
    mutationFn: async (body: TenantBranding) => (await apiClient.patch("/company/branding", body)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant/branding"] });
      toast.success("Branding saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save branding.")),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(form);
      }}
    >
      <TextField label="Logo URL" placeholder="https://…" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} />

      <ColorField label="Primary Color" value={form.primaryColor} onChange={(v) => setForm({ ...form, primaryColor: v })} />

      <div className="border-t border-border pt-4">
        <h3 className="mb-1 text-sm font-medium">Theme Colors</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Applied live across every module, form, and dashboard for everyone in your organization. Primary tints buttons, focus rings,
          and — unless you set them below — page background, cards, text, and borders for whichever light or dark mode each person is
          using. Accent colors highlights, badges, and secondary links. Leave a field blank to keep that derivation, or AccuQual's
          built-in palette when Primary is blank too. A user can still override Primary and Accent for themselves from Settings → Theme.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ColorField label="Secondary Color" value={form.secondaryColor} onChange={(v) => setForm({ ...form, secondaryColor: v })} />
          <ColorField label="Accent Color" value={form.accentColor} onChange={(v) => setForm({ ...form, accentColor: v })} />
          <ColorField label="Background (Light Mode)" value={form.backgroundLight} onChange={(v) => setForm({ ...form, backgroundLight: v })} />
          <ColorField label="Background (Dark Mode)" value={form.backgroundDark} onChange={(v) => setForm({ ...form, backgroundDark: v })} />
          <ColorField label="Text (Light Mode)" value={form.textLight} onChange={(v) => setForm({ ...form, textLight: v })} />
          <ColorField label="Text (Dark Mode)" value={form.textDark} onChange={(v) => setForm({ ...form, textDark: v })} />
          <ColorField label="Form Field Border" value={form.formFieldColor} onChange={(v) => setForm({ ...form, formFieldColor: v })} />
          <ColorField label="Button Color" value={form.buttonColor} onChange={(v) => setForm({ ...form, buttonColor: v })} />
          <ColorField label="Border Color" value={form.borderColor} onChange={(v) => setForm({ ...form, borderColor: v })} />
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="mb-1 text-sm font-medium">PDF Header &amp; Footer</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Stored for whenever AccuQual has a real PDF or print export to apply them to — no module currently generates a PDF or has a
          print view at all, so nothing consumes these two fields yet. Saved here rather than left unbuildable, the same way this page
          already stored PDF header/footer text before this round.
        </p>
        <TextAreaField label="PDF Header" value={form.pdfHeader} onChange={(e) => setForm({ ...form, pdfHeader: e.target.value })} />
        <div className="mt-3">
          <TextAreaField label="PDF Footer" value={form.pdfFooter} onChange={(e) => setForm({ ...form, pdfFooter: e.target.value })} />
        </div>
      </div>

      <button type="submit" disabled={save.isPending} className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {save.isPending ? "Saving…" : "Save Branding"}
      </button>
    </form>
  );
}

export function AdminTenantBrandingPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tenant Branding</h1>
      <AdminOnlyGuard>
        <BrandingForm />
      </AdminOnlyGuard>
    </div>
  );
}

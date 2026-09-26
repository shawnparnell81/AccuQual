import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, CheckCircle2, Clock } from "lucide-react";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { TextField, SelectField } from "../../components/forms/Field";
import type { AppRole } from "../../api/types";

interface SsoDomain {
  id: number;
  domain: string;
  verified: boolean;
  txtName: string;
  txtValue: string;
}
interface SsoConnection {
  displayName: string;
  issuer: string;
  clientId: string;
  enabled: boolean;
  autoProvision: boolean;
  defaultRoleId: number | null;
  enforceSso: boolean;
  requireVerifiedEmail: boolean;
}
interface SsoConfig {
  connection: SsoConnection | null;
  domains: SsoDomain[];
  redirectUri: string;
}

const KEY = ["sso/config"];

function CopyButton({ text }: { text: string }) {
  return (
    <button type="button" title="Copy" onClick={() => void navigator.clipboard?.writeText(text)} className="rounded p-1 text-muted-foreground hover:bg-muted">
      <Copy size={14} />
    </button>
  );
}

function DomainsPanel({ domains }: { domains: SsoDomain[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });

  const add = useMutation({
    mutationFn: async () => (await apiClient.post("/sso/domains", { domain })).data,
    onSuccess: () => {
      setDomain("");
      void refresh();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add that domain.")),
  });
  const verify = useMutation({
    mutationFn: async (id: number) => (await apiClient.post(`/sso/domains/${id}/verify`)).data,
    onSuccess: () => {
      toast.success("Domain verified.");
      void refresh();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't verify the domain.")),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/sso/domains/${id}`),
    onSuccess: () => void refresh(),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove the domain.")),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium">1. Email domains</h2>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">
        Only people whose email is on a domain you have proven you own can sign in through SSO. Add the domain, publish the DNS record shown, then verify.
      </p>
      <ul className="flex flex-col gap-3">
        {domains.map((d) => (
          <li key={d.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-medium">
                {d.verified ? <CheckCircle2 size={16} className="text-green-600" /> : <Clock size={16} className="text-amber-600" />}
                {d.domain}
                <span className="text-xs font-normal text-muted-foreground">{d.verified ? "Verified" : "Waiting for DNS record"}</span>
              </span>
              <span className="flex gap-2">
                {!d.verified && (
                  <button onClick={() => verify.mutate(d.id)} disabled={verify.isPending} className="rounded-md border border-border px-3 py-1 text-xs">
                    Verify
                  </button>
                )}
                <button onClick={() => remove.mutate(d.id)} className="text-xs text-muted-foreground hover:text-destructive">
                  Remove
                </button>
              </span>
            </div>
            {!d.verified && (
              <dl className="mt-2 grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">TXT record name</dt>
                <dd className="flex items-center gap-1 font-mono">
                  {d.txtName}
                  <CopyButton text={d.txtName} />
                </dd>
                <dt className="text-muted-foreground">TXT record value</dt>
                <dd className="flex items-center gap-1 break-all font-mono">
                  {d.txtValue}
                  <CopyButton text={d.txtValue} />
                </dd>
              </dl>
            )}
          </li>
        ))}
        {domains.length === 0 && <li className="text-sm text-muted-foreground">No domains yet.</li>}
      </ul>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="flex-1">
          <TextField label="Add a domain" placeholder="acme.com" value={domain} onChange={(e) => setDomain(e.target.value)} required />
        </div>
        <button type="submit" disabled={add.isPending} className="rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60">
          Add
        </button>
      </form>
    </div>
  );
}

function ConnectionPanel({ config }: { config: SsoConfig }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: roles = [] } = useQuery<AppRole[]>({ queryKey: ["roles"], queryFn: async () => (await apiClient.get("/roles")).data });
  const assignable = roles.filter((r) => r.name !== "admin" && r.name !== "supplier");

  const existing = config.connection;
  const [form, setForm] = useState({
    displayName: "Single sign-on",
    issuer: "",
    clientId: "",
    clientSecret: "",
    enabled: false,
    autoProvision: false,
    defaultRoleId: "",
    enforceSso: false,
    requireVerifiedEmail: true,
  });

  useEffect(() => {
    if (existing) {
      setForm({
        displayName: existing.displayName,
        issuer: existing.issuer,
        clientId: existing.clientId,
        clientSecret: "",
        enabled: existing.enabled,
        autoProvision: existing.autoProvision,
        defaultRoleId: existing.defaultRoleId ? String(existing.defaultRoleId) : "",
        enforceSso: existing.enforceSso,
        requireVerifiedEmail: existing.requireVerifiedEmail,
      });
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: async () =>
      (
        await apiClient.put("/sso", {
          displayName: form.displayName,
          issuer: form.issuer.trim(),
          clientId: form.clientId.trim(),
          ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
          enabled: form.enabled,
          autoProvision: form.autoProvision,
          defaultRoleId: form.autoProvision && form.defaultRoleId ? Number(form.defaultRoleId) : null,
          enforceSso: form.enforceSso,
          requireVerifiedEmail: form.requireVerifiedEmail,
        })
      ).data,
    onSuccess: () => {
      toast.success("Single sign-on settings saved.");
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save the settings.")),
  });
  const remove = useMutation({
    mutationFn: async () => apiClient.delete("/sso"),
    onSuccess: () => {
      toast.success("Single sign-on removed.");
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove it.")),
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const check = (label: string, key: "enabled" | "autoProvision" | "enforceSso" | "requireVerifiedEmail", help: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={form[key]} onChange={(e) => set(key, e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{help}</span>
      </span>
    </label>
  );

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <h2 className="text-sm font-medium">2. Identity provider (OpenID Connect)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Register AccuQual with your provider (Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak…) as a web application, using this redirect URL:
        </p>
        <p className="mt-2 flex items-center gap-1 break-all rounded-md bg-muted/50 p-2 font-mono text-xs">
          {config.redirectUri}
          <CopyButton text={config.redirectUri} />
        </p>
      </div>
      <TextField label="Button label" value={form.displayName} onChange={(e) => set("displayName", e.target.value)} required />
      <TextField label="Issuer URL" placeholder="https://login.example.com/oauth2/default" value={form.issuer} onChange={(e) => set("issuer", e.target.value)} required />
      <TextField label="Client ID" value={form.clientId} onChange={(e) => set("clientId", e.target.value)} required />
      <TextField
        label="Client secret"
        type="password"
        autoComplete="new-password"
        placeholder={existing ? "Saved — leave blank to keep it" : ""}
        value={form.clientSecret}
        onChange={(e) => set("clientSecret", e.target.value)}
        required={!existing}
      />

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        {check("Turn single sign-on on", "enabled", "Needs at least one verified domain and a reachable provider. We check the provider before saving.")}
        {check("Create accounts automatically on first sign-in", "autoProvision", "Someone on a verified domain with no AccuQual account gets one. They receive the role below — never an administrator.")}
        {form.autoProvision && (
          <SelectField label="Role for new SSO users" value={form.defaultRoleId} onChange={(e) => set("defaultRoleId", e.target.value)} required>
            <option value="">Choose a role…</option>
            {assignable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
        )}
        {check("Require single sign-on", "enforceSso", "Passwords stop working for everyone except administrators, who keep a password sign-in in case the provider is down.")}
        {check("Require the provider to confirm the email address", "requireVerifiedEmail", "Leave this on. Turn it off only for providers that never send that confirmation (Microsoft Entra ID often doesn't) — and only if your directory controls who can set an email address.")}
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={save.isPending} className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60">
          {save.isPending ? "Checking and saving…" : "Save"}
        </button>
        {existing && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Remove the single sign-on connection? People will sign in with passwords again.")) remove.mutate();
            }}
            className="text-sm text-muted-foreground hover:text-destructive"
          >
            Remove connection
          </button>
        )}
      </div>
    </form>
  );
}

/** Admin Console → Single Sign-On. Domain ownership first, then the provider, in the order the setup actually has to happen. */
export function AdminSsoPage() {
  const { data, isLoading } = useQuery<SsoConfig>({ queryKey: KEY, queryFn: async () => (await apiClient.get("/sso")).data });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Single Sign-On</h1>
        <p className="text-sm text-muted-foreground">Let people sign in with your company's identity provider instead of an AccuQual password.</p>
      </div>
      <AdminOnlyGuard>
        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DomainsPanel domains={data.domains} />
            <ConnectionPanel config={data} />
            <p className="text-xs text-muted-foreground">
              People who sign in through your provider skip AccuQual's own password and two-step prompts — your provider is responsible for those. Every SSO sign-in, new link, and refused attempt is recorded in the audit trail.
            </p>
          </>
        )}
      </AdminOnlyGuard>
    </div>
  );
}

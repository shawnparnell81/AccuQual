import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { useConfirm } from "../../components/shared/ConfirmDialog";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { SelectField, TextAreaField, TextField } from "../../components/forms/Field";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { formatDateTime } from "../../lib/dates";

type ModuleKey = "fai" | "productAlert" | "inventory";

interface ModuleRow {
  key: ModuleKey;
  label: string;
  recordType: string;
  enabled: boolean;
  lastCheck: { at: string; status: string; message: string; durationMs?: number } | null;
}

export interface NetSuiteView {
  accountId: string | null;
  environment: string | null;
  domain: string | null;
  clientId: string | null;
  certificateId: string | null;
  keyAlgorithm: string;
  hasPrivateKey: boolean;
  privateKeyReadable: boolean | null;
  detectedAlgorithm: string | null;
  certificate: { subject: string; validFrom: string; validTo: string; daysLeft: number; matchesPrivateKey: boolean | null } | null;
  configured: boolean;
  lastTest: { at: string; ok: boolean; code?: string; message: string; durationMs?: number; environment?: string } | null;
  modules: ModuleRow[];
  history: { id: number; action: string; description: string; at: string | null; by: string }[];
}

interface TestResult {
  ok: boolean;
  code: string;
  title: string;
  guidance: string;
  detail?: string;
  durationMs: number;
  at: string;
  accountId?: string;
  environment?: string;
}

const QUERY_KEY = ["settings/netsuite"];

const KEY_TYPES = [
  { value: "auto", label: "Detect automatically (recommended)" },
  { value: "ES256", label: "EC P-256 (ES256)" },
  { value: "ES384", label: "EC P-384 (ES384)" },
  { value: "ES512", label: "EC P-521 (ES512)" },
  { value: "PS256", label: "RSA-PSS (PS256)" },
  { value: "PS384", label: "RSA-PSS (PS384)" },
  { value: "PS512", label: "RSA-PSS (PS512)" },
];

const MODULE_HELP: Record<ModuleKey, string> = {
  fai: "The custom record the NetSuite developer builds for First Article Inspections, for example customrecord_fai.",
  productAlert: "The custom record for Product Alerts, for example customrecord_product_alert.",
  inventory: "Lookup only. AccuQual reads it when needed and never stores inventory. Standard choices: location or inventoryItem.",
};

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  reachable: { text: "Reachable", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  not_configured: { text: "Not configured", className: "border-border bg-muted text-muted-foreground" },
  no_permission: { text: "No permission", className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  not_found: { text: "Not found", className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  error: { text: "Error", className: "border-destructive/40 bg-destructive/10 text-destructive" },
};

const HISTORY_LABEL: Record<string, string> = {
  update: "Settings saved",
  key_replaced: "Private key replaced",
  module_enabled: "Module turned on",
  module_disabled: "Module turned off",
  remove: "Connection removed",
  connection_test: "Connection test",
  module_check: "Access check",
};

const SANDBOX_HINT = /_SB\d*$/i;

function environmentFor(accountId: string): string {
  const id = accountId.trim().toUpperCase().replace(/-/g, "_");
  if (!id) return "";
  if (SANDBOX_HINT.test(id)) return "Sandbox";
  if (/_RP\d*$/.test(id)) return "Release Preview";
  return "Production";
}

function Badge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.error!;
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.text}</span>;
}

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-2 text-xs">{children}</pre>;
}

/**
 * Settings → ERP / NetSuite. Admin only, enforced on the server
 * (settings.routes.ts → /settings/netsuite). AccuQual signs in to NetSuite with
 * OAuth 2.0 client credentials and only ever reads. The private key is
 * write-only: the server stores it encrypted and never sends it back.
 */
export function NetSuiteConnectorPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<NetSuiteView>({ queryKey: QUERY_KEY, queryFn: async () => (await apiClient.get("/settings/netsuite")).data });

  const [accountId, setAccountId] = useState("");
  const [clientId, setClientId] = useState("");
  const [certificateId, setCertificateId] = useState("");
  const [keyAlgorithm, setKeyAlgorithm] = useState("auto");
  const [privateKey, setPrivateKey] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [publicCertificate, setPublicCertificate] = useState("");
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [lastResult, setLastResult] = useState<TestResult | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (!data) return;
    setAccountId(data.accountId ?? "");
    setClientId(data.clientId ?? "");
    setCertificateId(data.certificateId ?? "");
    setKeyAlgorithm(data.keyAlgorithm ?? "auto");
    setModules(data.modules);
    setShowGuide((g) => g || !data.configured);
  }, [data]);

  const apply = (view: NetSuiteView) => queryClient.setQueryData(QUERY_KEY, view);

  const save = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post("/settings/netsuite", {
          accountId,
          clientId,
          certificateId,
          keyAlgorithm,
          ...(privateKey.trim() ? { privateKey } : {}),
          ...(publicCertificate.trim() ? { publicCertificate } : {}),
          modules: Object.fromEntries(modules.map((m) => [m.key, { recordType: m.recordType, enabled: m.enabled }])),
        })
      ).data as NetSuiteView,
    onSuccess: (view) => {
      apply(view);
      setPrivateKey("");
      setReplacingKey(false);
      setPublicCertificate("");
      toast.success("NetSuite settings saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save NetSuite settings.")),
  });

  const removeCert = useMutation({
    mutationFn: async () => (await apiClient.post("/settings/netsuite", { publicCertificate: "" })).data as NetSuiteView,
    onSuccess: (view) => {
      apply(view);
      toast.success("Certificate removed.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove the certificate.")),
  });

  const remove = useMutation({
    mutationFn: async () => (await apiClient.delete("/settings/netsuite")).data as NetSuiteView,
    onSuccess: (view) => {
      apply(view);
      setLastResult(null);
      setPrivateKey("");
      toast.success("NetSuite connection removed.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove the NetSuite connection.")),
  });

  const test = useMutation({
    mutationFn: async () => (await apiClient.post("/settings/netsuite/test")).data as TestResult,
    onSuccess: (result) => {
      setLastResult(result);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      if (result.ok) toast.success(`Connected to NetSuite (${result.environment}).`);
      else toast.error(result.title);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't run the connection test.")),
  });

  const check = useMutation({
    mutationFn: async (key: ModuleKey) => (await apiClient.post(`/settings/netsuite/modules/${key}/check`)).data as { status: string; message: string },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      if (result.status === "reachable") toast.success(result.message);
      else toast.error(result.message);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't check access.")),
  });

  if (isLoading) return <LoadingPlaceholder />;
  if (isError || !data) return <p className="text-sm text-destructive">Couldn't load NetSuite connection settings.</p>;

  const savedModules = new Map(data.modules.map((m) => [m.key, m]));
  const dirty =
    accountId !== (data.accountId ?? "") ||
    clientId !== (data.clientId ?? "") ||
    certificateId !== (data.certificateId ?? "") ||
    keyAlgorithm !== (data.keyAlgorithm ?? "auto") ||
    Boolean(privateKey.trim()) ||
    Boolean(publicCertificate.trim()) ||
    modules.some((m) => m.recordType !== savedModules.get(m.key)?.recordType || m.enabled !== savedModules.get(m.key)?.enabled);
  const env = environmentFor(accountId);
  const shownResult: TestResult | null =
    lastResult ??
    (data.lastTest
      ? { ok: data.lastTest.ok, code: data.lastTest.code ?? "", title: data.lastTest.ok ? "Connected" : "Last test failed", guidance: data.lastTest.message, durationMs: data.lastTest.durationMs ?? 0, at: data.lastTest.at, environment: data.lastTest.environment }
      : null);
  const cert = data.certificate;
  const setModule = (key: ModuleKey, patch: Partial<ModuleRow>) => setModules((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">{data.configured ? "Connection details saved" : "Not connected yet"}</h3>
          {data.environment && (
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${data.environment === "Production" ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-primary/40 bg-primary/10 text-primary"}`}>
              {data.environment}
            </span>
          )}
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">Read-only</span>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          AccuQual signs in to NetSuite as an app (OAuth 2.0 machine-to-machine, no user password) and only reads. It never creates, changes or deletes anything in NetSuite. Your NetSuite developer gives you the four values below.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <TextField label="Account ID" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="1234567 or 1234567_SB1" autoComplete="off" spellCheck={false} />
            <span className="text-xs text-muted-foreground">
              {env ? `${env} account${data.domain && accountId === data.accountId ? ` · ${data.domain}` : ""}` : "In NetSuite: Setup > Company > Company Information. Sandbox IDs end in _SB1."}
            </span>
          </div>
          <TextField label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="From the NetSuite integration record" autoComplete="off" spellCheck={false} />
          <TextField label="Certificate ID" value={certificateId} onChange={(e) => setCertificateId(e.target.value)} placeholder="From OAuth 2.0 Client Credentials Setup" autoComplete="off" spellCheck={false} />
          <SelectField label="Key type" value={keyAlgorithm} onChange={(e) => setKeyAlgorithm(e.target.value)}>
            {KEY_TYPES.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="mt-3">
          {data.hasPrivateKey && !replacingKey ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs font-semibold text-muted-foreground">Private key</span>
              <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs">
                Saved{data.detectedAlgorithm ? ` · ${data.detectedAlgorithm}` : ""} · encrypted, never shown again
              </span>
              {data.privateKeyReadable === false && <span className="text-xs text-destructive">This server can't read the saved key. Enter it again.</span>}
              <button type="button" onClick={() => setReplacingKey(true)} className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted">
                Replace key
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <TextAreaField
                label={data.hasPrivateKey ? "New private key (replaces the saved one)" : "Private key"}
                allowPictures={false}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder={"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"}
                rows={5}
                spellCheck={false}
                autoComplete="off"
              />
              <span className="text-xs text-muted-foreground">Paste the whole private.pem. It is encrypted on the server, never shown again and never written to logs.</span>
              {replacingKey && (
                <button
                  type="button"
                  onClick={() => {
                    setReplacingKey(false);
                    setPrivateKey("");
                  }}
                  className="w-fit text-xs text-primary hover:underline"
                >
                  Keep the saved key
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-1">
          {cert ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs font-semibold text-muted-foreground">Public certificate</span>
              <span
                className={`rounded-md border px-2 py-1 text-xs ${cert.daysLeft < 0 ? "border-destructive/40 bg-destructive/10 text-destructive" : cert.daysLeft <= 30 ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-border bg-muted"}`}
              >
                {cert.daysLeft < 0 ? `Expired ${formatDateTime(cert.validTo)}` : `Expires ${formatDateTime(cert.validTo)} (${cert.daysLeft} days)`}
                {cert.matchesPrivateKey === true ? " · matches the private key" : ""}
              </span>
              <button type="button" onClick={() => removeCert.mutate()} disabled={removeCert.isPending} className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60">
                Remove certificate
              </button>
            </div>
          ) : (
            <>
              <TextAreaField
                label="Public certificate (optional)"
                allowPictures={false}
                value={publicCertificate}
                onChange={(e) => setPublicCertificate(e.target.value)}
                placeholder={"-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"}
                rows={3}
                spellCheck={false}
              />
              <span className="text-xs text-muted-foreground">Optional. Paste public.pem so AccuQual can show when the certificate expires (NetSuite allows two years at most) and check it matches the key.</span>
            </>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-1 text-sm font-medium">Module access</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Which NetSuite records AccuQual may read for each module. Check access does one read and changes nothing. No data is synced or imported yet.
        </p>
        <div className="flex flex-col divide-y divide-border">
          {modules.map((m) => {
            const saved = savedModules.get(m.key);
            const status = saved?.lastCheck?.status ?? (m.recordType ? "" : "not_configured");
            return (
              <div key={m.key} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-end">
                <div className="flex min-w-[10rem] flex-col gap-1">
                  <span className="text-sm font-medium">{m.label}</span>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={m.enabled} onChange={(e) => setModule(m.key, { enabled: e.target.checked })} className="h-4 w-4 rounded border-form-field" />
                    Enabled
                  </label>
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <TextField label="NetSuite record type ID" value={m.recordType} onChange={(e) => setModule(m.key, { recordType: e.target.value })} placeholder={m.key === "inventory" ? "location" : "customrecord_…"} autoComplete="off" spellCheck={false} />
                  <span className="text-xs text-muted-foreground">{MODULE_HELP[m.key]}</span>
                </div>
                <div className="flex flex-col items-start gap-1 sm:w-56">
                  <div className="flex items-center gap-2">
                    {status && <Badge status={status} />}
                    <button
                      type="button"
                      onClick={() => check.mutate(m.key)}
                      disabled={check.isPending || dirty || !data.configured}
                      title={dirty ? "Save your changes first" : !data.configured ? "Finish the connection details first" : undefined}
                      className="rounded-md border border-primary px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
                    >
                      {check.isPending && check.variables === m.key ? "Checking…" : "Check access"}
                    </button>
                  </div>
                  {saved?.lastCheck && <span className="text-xs text-muted-foreground">{formatDateTime(saved.lastCheck.at)}: {saved.lastCheck.message}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => save.mutate()} disabled={save.isPending || !dirty} className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60">
          {save.isPending ? "Saving…" : "Save NetSuite settings"}
        </button>
        <button
          type="button"
          onClick={() => test.mutate()}
          disabled={test.isPending || dirty}
          title={dirty ? "Save your changes first" : undefined}
          className="w-fit rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
        >
          {test.isPending ? "Testing…" : "Test connection"}
        </button>
        {(data.accountId || data.hasPrivateKey) && (
          <button
            type="button"
            onClick={() =>
              void confirm({
                title: "Remove the NetSuite connection?",
                message: "This deletes the account ID, Client ID, Certificate ID, private key and certificate from AccuQual. Nothing in NetSuite changes.",
                confirmLabel: "Remove connection",
              }).then((ok) => ok && remove.mutate())
            }
            disabled={remove.isPending}
            className="w-fit rounded-md border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
          >
            {remove.isPending ? "Removing…" : "Remove connection"}
          </button>
        )}
      </div>

      {shownResult && (
        <div className={`rounded-lg border p-4 text-sm ${shownResult.ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`} role="status">
          <h3 className={`mb-1 font-medium ${shownResult.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>{shownResult.ok ? "Connected" : shownResult.title}</h3>
          {shownResult.ok ? (
            <p className="text-muted-foreground">
              Account {shownResult.accountId ?? data.accountId} · {shownResult.environment ?? data.environment} · {shownResult.durationMs} ms · {formatDateTime(shownResult.at)}
            </p>
          ) : (
            <>
              <p>{shownResult.guidance}</p>
              {shownResult.detail && <p className="mt-1 text-xs text-muted-foreground">NetSuite said: {shownResult.detail}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(shownResult.at)}</p>
            </>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <button type="button" onClick={() => setShowGuide((g) => !g)} className="flex w-full items-center justify-between text-left text-sm font-medium" aria-expanded={showGuide}>
          Setup guide for the NetSuite developer
          <span className="text-xs text-muted-foreground">{showGuide ? "Hide" : "Show"}</span>
        </button>
        {showGuide && (
          <ol className="mt-3 flex list-decimal flex-col gap-3 pl-5 text-sm">
            <li>
              <span className="font-medium">Turn on the features.</span> Setup &gt; Company &gt; Enable Features &gt; SuiteCloud: tick <em>REST Web Services</em> and <em>OAuth 2.0</em>.
            </li>
            <li>
              <span className="font-medium">Create the key pair and certificate</span> on any computer with OpenSSL. EC P-256 (recommended):
              <Code>{"openssl req -new -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -pkeyopt ec_param_enc:named_curve -nodes -days 730 -subj \"/CN=AccuQual\" -keyout private.pem -out public.pem"}</Code>
              Or RSA-PSS (choose PS256 above):
              <Code>{"openssl req -new -x509 -newkey rsa:4096 -sigopt rsa_padding_mode:pss -sha256 -sigopt rsa_pss_saltlen:64 -nodes -days 730 -subj \"/CN=AccuQual\" -keyout private.pem -out public.pem"}</Code>
              NetSuite allows a certificate for two years at most (730 days). Put a reminder in the calendar to replace it before then.
            </li>
            <li>
              <span className="font-medium">Create a role for AccuQual</span> (Setup &gt; Users/Roles &gt; Manage Roles &gt; New) with: <em>Log in using OAuth 2.0 Access Tokens</em> and <em>REST Web Services</em> (Setup tab), plus <em>View</em> on each record AccuQual reads (the FAI and Product Alert custom records, Locations or Items). No Create, Edit or Full access is needed.
            </li>
            <li>
              <span className="font-medium">Create the integration record</span> (Setup &gt; Integration &gt; Manage Integrations &gt; New), named AccuQual: under OAuth 2.0 tick <em>Client Credentials (Machine to Machine) Grant</em> and the scopes <em>REST Web Services</em> and <em>RESTlets</em>. Leave Token-Based Authentication and Authorization Code Grant off. Save and copy the <strong>Client ID</strong> (it is shown only once). No client secret is needed.
            </li>
            <li>
              <span className="font-medium">Map the certificate</span> (Setup &gt; Integration &gt; OAuth 2.0 Client Credentials (M2M) Setup &gt; Create New): pick the user (entity), the AccuQual role and the AccuQual integration, then upload <code>public.pem</code>. Copy the <strong>Certificate ID</strong>.
            </li>
            <li>
              <span className="font-medium">Send the Admin</span> the Account ID, Client ID, Certificate ID and <code>private.pem</code> through a secure channel (not plain email). Start with the sandbox account (ID ending in _SB1).
            </li>
            <li>
              <span className="font-medium">In AccuQual</span>: enter the four values, Save, then Test connection. Delete your local copy of <code>private.pem</code> once it works.
            </li>
          </ol>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">History</h3>
        {data.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes or tests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">When</th>
                  <th className="py-1 pr-3 font-medium">Who</th>
                  <th className="py-1 pr-3 font-medium">What</th>
                  <th className="py-1 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((h) => (
                  <tr key={h.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap py-1.5 pr-3">{formatDateTime(h.at)}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3">{h.by}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3">{HISTORY_LABEL[h.action] ?? h.action}</td>
                    <td className="py-1.5">{h.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

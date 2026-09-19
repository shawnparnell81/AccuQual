import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField, TextAreaField, SelectField } from "../../components/forms/Field";
import type { ErpConnectorPreset, ErpFieldMapping, ErpPresetModule, ErpPresetVendor, ErpTransformRule, ErpTriggerRule, ErpValidationRule } from "../../api/types";

const VENDORS: ErpPresetVendor[] = ["sap", "oracle", "netsuite", "epicor", "dynamics", "custom"];
const MODULES: ErpPresetModule[] = ["inventory", "suppliers", "purchaseOrders", "workOrders", "ncr", "capa", "training", "audits", "documentControl"];
const TRANSFORM_KINDS = ["none", "dateFormat", "statusMap", "codeMap", "stringCase", "staticValue", "template", "numeric", "boolean"] as const;
const TRIGGER_KINDS: ErpTriggerRule["on"][] = ["create", "update", "statusChange", "workflowEvent"];

// Sample source records for the client-side, no-round-trip preview — one
// per module, plausible field shapes for what a real record of that type
// looks like. Kept intentionally small; this is a preview aid, not test data.
const SAMPLE_RECORDS: Record<string, Record<string, unknown>> = {
  suppliers: { name: "Acme Fasteners", contactEmail: "ap@acmefasteners.example", status: "active" },
  purchaseOrders: { supplierId: 42, createdAt: "2026-03-14T00:00:00.000Z", status: "sent" },
  inventory: { sku: "BOLT-M6-20", quantityOnHand: 1200, status: "active" },
  workOrders: { woNumber: "WO-1042", status: "in_progress" },
  ncr: { title: "Dimension out of tolerance", severity: "major", status: "open" },
  capa: { title: "Root cause: fixture wear", status: "in_progress" },
  training: { courseTitle: "ISO 9001 Refresher", status: "assigned" },
  audits: { name: "Q1 Internal Process Audit", status: "scheduled" },
  documentControl: { title: "SOP-114 Incoming Inspection", status: "approved" },
};

function resolveSourceValue(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), record);
}

/** Client-side mirror of erpMappingEngine.ts's applyFieldMapping — for the instant preview panel only, never used for a real sync (the server always re-applies its own copy). */
function previewMapping(record: Record<string, unknown>, fieldMappings: ErpFieldMapping[]): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const mapping of fieldMappings) {
    const raw = resolveSourceValue(record, mapping.source);
    mapped[mapping.target] = mapping.transform ? applyTransformPreview(raw, mapping.transform, record) : raw;
  }
  return mapped;
}

function applyTransformPreview(raw: unknown, transform: ErpTransformRule, record: Record<string, unknown>): unknown {
  switch (transform.kind) {
    case "dateFormat": {
      const date = raw instanceof Date ? raw : new Date(String(raw));
      if (isNaN(date.getTime())) return "";
      const pad = (n: number) => String(n).padStart(2, "0");
      return transform.to.replace(/YYYY|MM|DD/g, (t) => ({ YYYY: String(date.getUTCFullYear()), MM: pad(date.getUTCMonth() + 1), DD: pad(date.getUTCDate()) })[t] ?? t);
    }
    case "statusMap":
    case "codeMap":
      return transform.map[String(raw)] ?? transform.default ?? raw;
    case "stringCase":
      if (typeof raw !== "string") return raw;
      if (transform.case === "upper") return raw.toUpperCase();
      if (transform.case === "lower") return raw.toLowerCase();
      return raw.replace(/\w\S*/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
    case "staticValue":
      return transform.value;
    case "template":
      return transform.template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => String(resolveSourceValue(record, path) ?? ""));
    case "numeric": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (isNaN(n)) return raw;
      if (transform.op === "round") return Math.round(n);
      if (transform.op === "multiply") return n * (transform.value ?? 1);
      if (transform.op === "divide") return transform.value ? n / transform.value : n;
      return n + (transform.value ?? 0);
    }
    case "boolean": {
      const b = typeof raw === "boolean" ? raw : raw === "true" || raw === true;
      if (transform.op === "invert") return !b;
      if (transform.op === "toYesNo") return b ? "Yes" : "No";
      return b ? "true" : "false";
    }
  }
}

export function ErpPresetEditorPage() {
  return (
    <AdminOnlyGuard>
      <ErpPresetEditorPageBody />
    </AdminOnlyGuard>
  );
}

function ErpPresetEditorPageBody() {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: existing, isLoading } = useQuery<ErpConnectorPreset>({
    queryKey: ["erp-presets", id],
    queryFn: async () => (await apiClient.get(`/erp/presets/${id}`)).data,
    enabled: !isNew,
  });

  const [vendor, setVendor] = useState<ErpPresetVendor>("sap");
  const [module, setModule] = useState<ErpPresetModule>("suppliers");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [direction, setDirection] = useState<"push" | "pull" | "bidirectional">("push");
  const [fieldMappings, setFieldMappings] = useState<ErpFieldMapping[]>([]);
  const [triggers, setTriggers] = useState<ErpTriggerRule[]>([]);
  const [validationRules, setValidationRules] = useState<ErpValidationRule[]>([]);

  useEffect(() => {
    if (!existing) return;
    setVendor(existing.vendor);
    setModule(existing.module);
    setName(existing.name);
    setDescription(existing.description ?? "");
    setDirection(existing.direction);
    setFieldMappings(existing.mappingConfig.fieldMappings);
    setTriggers(existing.mappingConfig.triggers);
    setValidationRules(existing.mappingConfig.validationRules);
  }, [existing]);

  const save = useMutation({
    mutationFn: async () => {
      const mappingConfig = { fieldMappings, triggers, validationRules };
      if (isNew) {
        return (await apiClient.post("/erp/presets", { vendor, module, name, description, direction, mappingConfig })).data as ErpConnectorPreset;
      }
      return (await apiClient.put(`/erp/presets/${id}`, { name, description, direction, mappingConfig })).data as ErpConnectorPreset;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["erp-presets"] });
      toast.success("Preset saved.");
      if (isNew) navigate(`/erp/presets/${saved.id}`, { replace: true });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save this preset.")),
  });

  const saveAndActivate = useMutation({
    mutationFn: async () => {
      const mappingConfig = { fieldMappings, triggers, validationRules };
      const saved = isNew
        ? ((await apiClient.post("/erp/presets", { vendor, module, name, description, direction, mappingConfig })).data as ErpConnectorPreset)
        : ((await apiClient.put(`/erp/presets/${id}`, { name, description, direction, mappingConfig })).data as ErpConnectorPreset);
      await apiClient.post(`/erp/presets/${saved.id}/activate`);
      return saved;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["erp-presets"] });
      toast.success("Preset saved and activated.");
      navigate(`/erp/presets/${saved.id}`, { replace: true });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save and activate this preset.")),
  });

  function addFieldMapping() {
    setFieldMappings((rows) => [...rows, { source: "", target: "" }]);
  }
  function updateFieldMapping(i: number, patch: Partial<ErpFieldMapping>) {
    setFieldMappings((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeFieldMapping(i: number) {
    setFieldMappings((rows) => rows.filter((_, idx) => idx !== i));
  }

  function addValidationRule() {
    setValidationRules((rows) => [...rows, { field: "", required: true }]);
  }
  function updateValidationRule(i: number, patch: Partial<ErpValidationRule>) {
    setValidationRules((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeValidationRule(i: number) {
    setValidationRules((rows) => rows.filter((_, idx) => idx !== i));
  }

  function toggleTrigger(on: ErpTriggerRule["on"]) {
    setTriggers((rows) => (rows.some((r) => r.on === on) ? rows.filter((r) => r.on !== on) : [...rows, { on }]));
  }

  function setStatusChangeValues(values: string[]) {
    setTriggers((rows) => rows.map((r) => (r.on === "statusChange" ? { ...r, statusValues: values.length > 0 ? values : undefined } : r)));
  }

  const sampleRecord = SAMPLE_RECORDS[module] ?? {};
  const previewOutput = useMemo(() => previewMapping(sampleRecord, fieldMappings), [sampleRecord, fieldMappings]);
  const sortedHistory = useMemo(() => [...(existing?.versionHistory ?? [])].sort((a, b) => b.version - a.version), [existing]);

  if (!isNew && isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{isNew ? "New ERP Preset" : name}</h1>
          {!isNew && existing && (
            <p className="text-sm text-muted-foreground">
              v{existing.version} {existing.isActive && "· Active"}
            </p>
          )}
        </div>
        <button onClick={() => navigate("/erp/presets")} className="text-sm text-muted-foreground hover:underline">
          ← Back to presets
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          {isNew ? (
            <SelectField label="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value as ErpPresetVendor)}>
              {VENDORS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </SelectField>
          ) : (
            <TextField label="Vendor" value={vendor} disabled />
          )}
          {isNew ? (
            <SelectField label="Module" value={module} onChange={(e) => setModule(e.target.value as ErpPresetModule)}>
              {MODULES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </SelectField>
          ) : (
            <TextField label="Module" value={module} disabled />
          )}
          <SelectField label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
            <option value="push">Push (AccuQual → ERP)</option>
            <option value="pull">Pull (ERP → AccuQual)</option>
            <option value="bidirectional">Bidirectional</option>
          </SelectField>
        </div>
        <div className="mt-3">
          <TextAreaField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Field Mappings</h2>
        <div className="flex flex-col gap-2">
          {fieldMappings.map((mapping, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[10rem] flex-1">
                  <TextField label="AccuQual field" value={mapping.source} onChange={(e) => updateFieldMapping(i, { source: e.target.value })} placeholder="e.g. name, address.city" />
                </div>
                <div className="min-w-[10rem] flex-1">
                  <TextField label={`${vendor.toUpperCase()} field`} value={mapping.target} onChange={(e) => updateFieldMapping(i, { target: e.target.value })} placeholder="e.g. NAME1" />
                </div>
                <div className="min-w-[9rem]">
                  <SelectField
                    label="Transform"
                    value={mapping.transform?.kind ?? "none"}
                    onChange={(e) => {
                      const kind = e.target.value as (typeof TRANSFORM_KINDS)[number];
                      if (kind === "none") return updateFieldMapping(i, { transform: undefined });
                      const defaults: Record<string, ErpTransformRule> = {
                        dateFormat: { kind: "dateFormat", from: "ISO", to: "YYYYMMDD" },
                        statusMap: { kind: "statusMap", map: {} },
                        codeMap: { kind: "codeMap", map: {} },
                        stringCase: { kind: "stringCase", case: "upper" },
                        staticValue: { kind: "staticValue", value: "" },
                        template: { kind: "template", template: "" },
                        numeric: { kind: "numeric", op: "round" },
                        boolean: { kind: "boolean", op: "invert" },
                      };
                      updateFieldMapping(i, { transform: defaults[kind] });
                    }}
                  >
                    {TRANSFORM_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <button onClick={() => removeFieldMapping(i)} className="rounded-md px-2 py-2 text-xs text-muted-foreground hover:text-destructive">
                  Remove
                </button>
              </div>
              {mapping.transform?.kind === "dateFormat" && (
                <div className="flex gap-2 pl-1">
                  <TextField label="To format" value={mapping.transform.to} onChange={(e) => updateFieldMapping(i, { transform: { kind: "dateFormat", from: "ISO", to: e.target.value } })} placeholder="YYYYMMDD" />
                </div>
              )}
              {(mapping.transform?.kind === "statusMap" || mapping.transform?.kind === "codeMap") && (
                <TransformMapEditor
                  transform={mapping.transform}
                  onChange={(map, def) => updateFieldMapping(i, { transform: { kind: mapping.transform!.kind as "statusMap" | "codeMap", map, default: def } })}
                />
              )}
              {mapping.transform?.kind === "stringCase" && (
                <SelectField label="Case" value={mapping.transform.case} onChange={(e) => updateFieldMapping(i, { transform: { kind: "stringCase", case: e.target.value as "upper" | "lower" | "title" } })}>
                  <option value="upper">UPPER</option>
                  <option value="lower">lower</option>
                  <option value="title">Title Case</option>
                </SelectField>
              )}
              {mapping.transform?.kind === "staticValue" && (
                <TextField label="Static value" value={mapping.transform.value} onChange={(e) => updateFieldMapping(i, { transform: { kind: "staticValue", value: e.target.value } })} />
              )}
              {mapping.transform?.kind === "template" && (
                <TextField label="Template" value={mapping.transform.template} onChange={(e) => updateFieldMapping(i, { transform: { kind: "template", template: e.target.value } })} placeholder="{{firstName}} {{lastName}}" />
              )}
              {mapping.transform?.kind === "numeric" &&
                (() => {
                  const numericTransform = mapping.transform;
                  return (
                    <div className="flex gap-2 pl-1">
                      <SelectField
                        label="Operation"
                        value={numericTransform.op}
                        onChange={(e) => updateFieldMapping(i, { transform: { kind: "numeric", op: e.target.value as "round" | "multiply" | "divide" | "add", value: numericTransform.value } })}
                      >
                        <option value="round">Round to whole number</option>
                        <option value="multiply">Multiply by</option>
                        <option value="divide">Divide by</option>
                        <option value="add">Add (use a negative to subtract)</option>
                      </SelectField>
                      {numericTransform.op !== "round" && (
                        <TextField
                          label="Value"
                          type="number"
                          value={numericTransform.value ?? ""}
                          onChange={(e) => updateFieldMapping(i, { transform: { kind: "numeric", op: numericTransform.op, value: Number(e.target.value) } })}
                        />
                      )}
                    </div>
                  );
                })()}
              {mapping.transform?.kind === "boolean" && (
                <SelectField label="Operation" value={mapping.transform.op} onChange={(e) => updateFieldMapping(i, { transform: { kind: "boolean", op: e.target.value as "invert" | "toYesNo" | "toTrueFalseString" } })}>
                  <option value="invert">Invert (true ↔ false)</option>
                  <option value="toYesNo">To "Yes"/"No"</option>
                  <option value="toTrueFalseString">To "true"/"false" text</option>
                </SelectField>
              )}
            </div>
          ))}
          <button onClick={addFieldMapping} className="w-fit rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            + Add mapping
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Triggers</h2>
        <p className="mb-3 text-xs text-muted-foreground">No triggers selected means every enabled sync run always includes this preset's module.</p>
        <div className="flex flex-col gap-2 text-sm">
          {TRIGGER_KINDS.map((kind) => (
            <div key={kind} className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={triggers.some((t) => t.on === kind)} onChange={() => toggleTrigger(kind)} />
                {kind}
              </label>
              {kind === "statusChange" && triggers.some((t) => t.on === "statusChange") && (
                <div className="w-96">
                  <TextField
                    label=""
                    placeholder="Only these status values (comma-separated) — blank matches any"
                    defaultValue={(triggers.find((t) => t.on === "statusChange")?.statusValues ?? []).join(", ")}
                    onBlur={(e) => setStatusChangeValues(e.target.value.split(",").map((v) => v.trim()).filter(Boolean))}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Validation Rules</h2>
        <div className="flex flex-col gap-2">
          {validationRules.map((rule, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[9rem] flex-1">
                <TextField label="Field" value={rule.field} onChange={(e) => updateValidationRule(i, { field: e.target.value })} />
              </div>
              <div className="min-w-[10rem] flex-1">
                <TextField
                  label="Regex pattern (optional)"
                  value={rule.pattern ?? ""}
                  onChange={(e) => updateValidationRule(i, { pattern: e.target.value || undefined })}
                  placeholder="^[A-Z]{2}\d{4}$"
                />
              </div>
              <div className="min-w-[9rem] flex-1">
                <TextField
                  label="Must equal field (optional)"
                  value={rule.equalsField ?? ""}
                  onChange={(e) => updateValidationRule(i, { equalsField: e.target.value || undefined })}
                  placeholder="e.g. confirmEmail"
                />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" checked={!!rule.required} onChange={(e) => updateValidationRule(i, { required: e.target.checked })} />
                Required
              </label>
              <button onClick={() => removeValidationRule(i)} className="rounded-md px-2 py-2 text-xs text-muted-foreground hover:text-destructive">
                Remove
              </button>
            </div>
          ))}
          <button onClick={addValidationRule} className="w-fit rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            + Add rule
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-medium">Preview</h2>
        <p className="mb-3 text-xs text-muted-foreground">A sample {module} record, mapped with the rules above — computed locally, no server call.</p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(previewOutput, null, 2)}</pre>
      </div>

      {!isNew && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Version History</h2>
          {sortedHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No prior versions yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {sortedHistory.map((entry) => (
                <li key={entry.version} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                  <span className="font-medium">v{entry.version}</span>
                  <span className="text-xs text-muted-foreground">{new Date(entry.updatedAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => saveAndActivate.mutate()}
          disabled={saveAndActivate.isPending || !name.trim()}
          className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
        >
          {saveAndActivate.isPending ? "Saving…" : "Save & Activate"}
        </button>
      </div>
    </div>
  );
}

/** Inline key→value list editor for statusMap/codeMap transforms — same hand-rolled add/remove-row pattern as the rest of this page. */
function TransformMapEditor({ transform, onChange }: { transform: { kind: "statusMap" | "codeMap"; map: Record<string, string>; default?: string }; onChange: (map: Record<string, string>, def?: string) => void }) {
  const entries = Object.entries(transform.map);

  function updateEntry(i: number, key: string, value: string) {
    const next = [...entries];
    next[i] = [key, value];
    onChange(Object.fromEntries(next), transform.default);
  }
  function removeEntry(i: number) {
    onChange(Object.fromEntries(entries.filter((_, idx) => idx !== i)), transform.default);
  }
  function addEntry() {
    onChange({ ...transform.map, "": "" }, transform.default);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-2">
      {entries.map(([key, value], i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={key} onChange={(e) => updateEntry(i, e.target.value, value)} placeholder="AccuQual value" className="w-32 rounded-md border border-form-field bg-background px-2 py-1 text-xs" />
          <span className="text-xs text-muted-foreground">→</span>
          <input value={value} onChange={(e) => updateEntry(i, key, e.target.value)} placeholder="ERP value" className="w-32 rounded-md border border-form-field bg-background px-2 py-1 text-xs" />
          <button onClick={() => removeEntry(i)} className="text-xs text-muted-foreground hover:text-destructive">
            Remove
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button onClick={addEntry} className="w-fit rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
          + Add value mapping
        </button>
        <input
          value={transform.default ?? ""}
          onChange={(e) => onChange(transform.map, e.target.value)}
          placeholder="Default (unmapped values)"
          className="w-40 rounded-md border border-form-field bg-background px-2 py-1 text-xs"
        />
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { SelectField } from "../../components/forms/Field";
import { Modal } from "../../components/modals/Modal";
import { BUCKET_CLASSES } from "../../components/tables/StatusBadge";
import type { ErpConnectorPreset, ErpPresetModule, ErpPresetVendor } from "../../api/types";

const VENDOR_LABELS: Record<ErpPresetVendor, string> = { sap: "SAP", oracle: "Oracle", netsuite: "NetSuite", epicor: "Epicor", dynamics: "Microsoft Dynamics", custom: "Custom" };
const MODULE_LABELS: Record<ErpPresetModule, string> = {
  inventory: "Inventory",
  suppliers: "Suppliers",
  purchaseOrders: "Purchase Orders",
  workOrders: "Work Orders",
  ncr: "NCR",
  capa: "CAPA",
  training: "Training",
  audits: "Audits",
  documentControl: "Document Control",
};

function useErpPresets() {
  return useQuery<ErpConnectorPreset[]>({ queryKey: ["erp-presets"], queryFn: async () => (await apiClient.get("/erp/presets")).data });
}

export function ErpPresetsListPage() {
  return (
    <AdminOnlyGuard>
      <ErpPresetsListPageBody />
    </AdminOnlyGuard>
  );
}

function ErpPresetsListPageBody() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: presets = [], isLoading } = useErpPresets();
  const [vendorFilter, setVendorFilter] = useState<string>("");
  const [moduleFilter, setModuleFilter] = useState<string>("");
  const [preview, setPreview] = useState<ErpConnectorPreset | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["erp-presets"] });

  const activate = useMutation({
    mutationFn: async (id: number) => (await apiClient.post(`/erp/presets/${id}/activate`)).data,
    onSuccess: () => {
      invalidate();
      toast.success("Preset activated.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't activate this preset.")),
  });

  const clone = useMutation({
    mutationFn: async (id: number) => (await apiClient.post(`/erp/presets/${id}/clone`)).data as ErpConnectorPreset,
    onSuccess: (cloned) => {
      invalidate();
      navigate(`/erp/presets/${cloned.id}`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't customize this preset.")),
  });

  const filtered = useMemo(
    () => presets.filter((p) => (!vendorFilter || p.vendor === vendorFilter) && (!moduleFilter || p.module === moduleFilter)),
    [presets, vendorFilter, moduleFilter]
  );

  const byVendor = useMemo(() => {
    const groups = new Map<string, ErpConnectorPreset[]>();
    for (const preset of filtered) {
      const list = groups.get(preset.vendor) ?? [];
      list.push(preset);
      groups.set(preset.vendor, list);
    }
    return [...groups.entries()];
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">ERP Connector Presets</h1>
          <p className="text-sm text-muted-foreground">Vendor field mappings, transforms, and validation rules for the ERP sync engine.</p>
        </div>
        <button onClick={() => navigate("/erp/presets/new")} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          + New Preset
        </button>
      </div>

      <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
        <div className="w-48">
          <SelectField label="Vendor" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
            <option value="">All vendors</option>
            {Object.entries(VENDOR_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-48">
          <SelectField label="Module" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
            <option value="">All modules</option>
            {Object.entries(MODULE_LABELS).map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : byVendor.length === 0 ? (
        <p className="text-sm text-muted-foreground">No presets match these filters.</p>
      ) : (
        byVendor.map(([vendor, vendorPresets]) => (
          <div key={vendor} className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-medium">{VENDOR_LABELS[vendor as ErpPresetVendor] ?? vendor}</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {vendorPresets.map((preset) => (
                <li key={preset.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{preset.name}</span>
                      {preset.isActive && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BUCKET_CLASSES.success}`}>Active</span>}
                      {preset.tenantId === null && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Global</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {MODULE_LABELS[preset.module] ?? preset.module} · v{preset.version}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setPreview(preset)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                      Preview
                    </button>
                    {preset.tenantId === null ? (
                      <button onClick={() => clone.mutate(preset.id)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                        Customize
                      </button>
                    ) : (
                      <button onClick={() => navigate(`/erp/presets/${preset.id}`)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                        Edit
                      </button>
                    )}
                    {preset.tenantId !== null && !preset.isActive && (
                      <button onClick={() => activate.mutate(preset.id)} className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground">
                        Activate
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      <Modal title={preview?.name ?? ""} isOpen={preview !== null} onClose={() => setPreview(null)}>
        {preview && (
          <div className="flex flex-col gap-3 text-sm">
            {preview.description && <p className="text-muted-foreground">{preview.description}</p>}
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 pr-2">AccuQual field</th>
                  <th className="pb-1 pr-2">→</th>
                  <th className="pb-1">{VENDOR_LABELS[preview.vendor]} field</th>
                </tr>
              </thead>
              <tbody>
                {preview.mappingConfig.fieldMappings.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-2 text-muted-foreground">
                      No field mappings yet.
                    </td>
                  </tr>
                ) : (
                  preview.mappingConfig.fieldMappings.map((m, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1 pr-2 font-mono text-xs">{m.source}</td>
                      <td className="py-1 pr-2 text-muted-foreground">→</td>
                      <td className="py-1 font-mono text-xs">
                        {m.target}
                        {m.transform && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{m.transform.kind}</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

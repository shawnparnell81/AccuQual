import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { SelectField } from "../../components/forms/Field";
import { Modal } from "../../components/modals/Modal";
import { StatusBadge } from "../../components/tables/StatusBadge";
import type { ErpErrorType, ErpSyncError, ErpSyncErrorsListResult } from "../../api/types";

const ERROR_TYPES: ErpErrorType[] = ["mappingError", "validationError", "transformError", "triggerError", "erpApiError", "unexpectedError"];
const MODULES = ["inventory", "suppliers", "purchaseOrders", "workOrders", "ncr", "capa", "training", "audits", "documentControl"];
const PAGE_SIZE = 25;

function useErpSyncErrors(filters: { module: string; errorType: string; resolved: string; offset: number }) {
  return useQuery<ErpSyncErrorsListResult>({
    queryKey: ["erp/errors", filters],
    queryFn: async () =>
      (
        await apiClient.get("/erp/errors", {
          params: {
            module: filters.module || undefined,
            errorType: filters.errorType || undefined,
            resolved: filters.resolved || undefined,
            limit: PAGE_SIZE,
            offset: filters.offset,
          },
        })
      ).data,
  });
}

export function ErpSyncErrorsPage() {
  return (
    <AdminOnlyGuard>
      <ErpSyncErrorsPageBody />
    </AdminOnlyGuard>
  );
}

function ErpSyncErrorsPageBody() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [module, setModule] = useState("");
  const [errorType, setErrorType] = useState("");
  const [resolved, setResolved] = useState("false");
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<ErpSyncError | null>(null);

  const { data, isLoading } = useErpSyncErrors({ module, errorType, resolved, offset });

  const resetAndSet = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setOffset(0);
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["erp/errors"] });

  const resolve = useMutation({
    mutationFn: async (id: number) => (await apiClient.post(`/erp/errors/${id}/resolve`)).data as ErpSyncError,
    onSuccess: (updated) => {
      invalidate();
      setDetail((d) => (d?.id === updated.id ? updated : d));
      toast.success("Marked resolved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't resolve this error.")),
  });

  const retry = useMutation({
    mutationFn: async (id: number) => (await apiClient.post(`/erp/errors/${id}/retry`)).data as { resolved: boolean; error: ErpSyncError },
    onSuccess: ({ resolved: didResolve, error }) => {
      invalidate();
      setDetail((d) => (d?.id === error.id || d?.id === undefined ? error : d));
      if (didResolve) toast.success("Retry succeeded — error resolved.");
      else toast.error("Retry failed — see the new error entry for details.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't retry this error.")),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">ERP Sync Errors</h1>
        <p className="text-sm text-muted-foreground">Every mapping, validation, transform, trigger, and delivery failure the ERP sync engine has recorded.</p>
      </div>

      <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
        <div className="w-48">
          <SelectField label="Module" value={module} onChange={(e) => resetAndSet(setModule)(e.target.value)}>
            <option value="">All modules</option>
            {MODULES.map((m) => (
              <option key={m} value={m}>
                {m.replace(/([A-Z])/g, " $1")}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-52">
          <SelectField label="Error type" value={errorType} onChange={(e) => resetAndSet(setErrorType)(e.target.value)}>
            <option value="">All types</option>
            {ERROR_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/([A-Z])/g, " $1")}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-44">
          <SelectField label="Status" value={resolved} onChange={(e) => resetAndSet(setResolved)(e.target.value)}>
            <option value="false">Unresolved</option>
            <option value="true">Resolved</option>
            <option value="">All</option>
          </SelectField>
        </div>
      </div>

      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No errors match these filters.</p>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="pb-2">When</th>
                <th className="pb-2">Module</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Message</th>
                <th className="pb-2">Status</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-1.5 text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="py-1.5 capitalize">{row.module.replace(/([A-Z])/g, " $1")}</td>
                  <td className="py-1.5">
                    <StatusBadge value={row.errorType} />
                  </td>
                  <td className="max-w-md truncate py-1.5" title={row.message}>
                    {row.message}
                  </td>
                  <td className="py-1.5">{row.resolvedAt ? <StatusBadge value="resolved" /> : <span className="text-xs text-muted-foreground">Unresolved</span>}</td>
                  <td className="py-1.5 text-right">
                    <button type="button" onClick={() => setDetail(row)} className="text-xs text-primary hover:underline">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>{total === 0 ? "0 results" : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOffset((o) => Math.max(o - PAGE_SIZE, 0))}
                disabled={offset === 0}
                className="rounded-md border border-border px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total}
                className="rounded-md border border-border px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal title={detail ? `${detail.module} · ${detail.errorType}` : ""} isOpen={detail !== null} onClose={() => setDetail(null)}>
        {detail && (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={detail.errorType} />
              {detail.resolvedAt ? <StatusBadge value="resolved" /> : <span className="text-xs text-muted-foreground">Unresolved</span>}
              {detail.presetId && (
                <span className="text-xs text-muted-foreground">
                  Preset #{detail.presetId}
                  {detail.presetVersion ? ` v${detail.presetVersion}` : ""}
                </span>
              )}
            </div>
            <p>{detail.message}</p>
            {detail.payloadSnapshot && detail.payloadSnapshot.failedFields.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Failed fields (source record #{detail.payloadSnapshot.sourceId})</p>
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="pb-1 pr-2">Field</th>
                      <th className="pb-1 pr-2">Value</th>
                      <th className="pb-1">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.payloadSnapshot.failedFields.map((f, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1 pr-2 font-mono">{f.field}</td>
                        <td className="py-1 pr-2 font-mono">{f.value === undefined ? "—" : JSON.stringify(f.value)}</td>
                        <td className="py-1">{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {detail.details && Object.keys(detail.details).length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Details</p>
                <pre className="max-h-48 overflow-auto rounded-md bg-background p-2 text-xs">{JSON.stringify(detail.details, null, 2)}</pre>
              </div>
            )}
            <div className="mt-2 flex justify-end gap-2">
              {!detail.resolvedAt && (
                <>
                  <button
                    type="button"
                    onClick={() => retry.mutate(detail.id)}
                    disabled={retry.isPending}
                    className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => resolve.mutate(detail.id)}
                    disabled={resolve.isPending}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                  >
                    Mark Resolved
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

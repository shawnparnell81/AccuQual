import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useAuthStore } from "../../store/authStore";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { Modal } from "../../components/modals/Modal";
import type { QualityInspectionReport, QualityInspectionItem, InspectionType, InspectionFinalStatus } from "../../api/types";

const reportHooks = createResourceHooks<QualityInspectionReport>("quality-inspection-reports");
const INSPECTION_TYPES: InspectionType[] = ["incoming", "in_process", "final"];
const FINAL_STATUSES: InspectionFinalStatus[] = ["accepted", "rejected", "rework_required", "accepted_via_deviation"];

/**
 * Quality Inspection Report — built from a real supplied HTML mockup,
 * styled to the app's own theme (see accuqual-qms-forms-batch memory)
 * rather than the mockup's own blue accent colors. Not on the generic QMS
 * Simple Form engine: its header fields don't match that engine's shape —
 * though its "Inspection Checklist" section IS a real freely-addable
 * table, same reasoning DocumentChangeRequest's own child tables use.
 */
export function QualityInspectionReportDetailPage() {
  const { id } = useParams();
  const reportId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const logoUrl = useAuthStore((s) => s.tenant?.branding?.logoUrl);
  const { data: report, isLoading } = reportHooks.useOne(reportId);
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["quality-inspection-reports", reportId] });

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiClient.patch(`/quality-inspection-reports/${reportId}`, body)).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update.")),
  });

  const addItem = useMutation({
    mutationFn: async () => (await apiClient.post(`/quality-inspection-reports/${reportId}/items`, {})).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add that row.")),
  });
  const patchItem = useMutation({
    mutationFn: async ({ itemId, body }: { itemId: number; body: Record<string, unknown> }) => (await apiClient.patch(`/quality-inspection-reports/${reportId}/items/${itemId}`, body)).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update that row.")),
  });
  const deleteItem = useMutation({
    mutationFn: async (itemId: number) => apiClient.delete(`/quality-inspection-reports/${reportId}/items/${itemId}`),
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove that row.")),
  });

  const deleteReport = useMutation({
    mutationFn: async () => apiClient.delete(`/quality-inspection-reports/${reportId}`),
    onSuccess: () => {
      toast.success("Deleted.");
      navigate("/quality-inspection-reports");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't delete.")),
  });

  if (isLoading || !report) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const items = report.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between print:hidden">
        <button onClick={() => navigate("/quality-inspection-reports")} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to list
        </button>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Print
          </button>
          <button onClick={() => setDeleteOpen(true)} className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10">
            Delete
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 print:border-black print:bg-white print:text-black">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 print:border-black">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="h-12 w-12 rounded-md border border-border object-cover print:border-black" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-muted text-xs font-semibold text-muted-foreground print:border-black">LOGO</div>
            )}
            <div>
              <h1 className="text-xl font-semibold uppercase tracking-wide">Quality Inspection Report</h1>
              <p className="text-xs text-muted-foreground print:text-black">Receiving / In-Process / Final Audit</p>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground print:text-black">
            <div>REPORT ID</div>
            <div className="text-lg font-semibold text-foreground print:text-black">#{report.id}</div>
          </div>
        </div>

        <h2 className="mb-2 mt-6 border-l-4 border-primary bg-muted/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide print:border-black print:bg-transparent print:text-black">
          1. General Information
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Inspection Date" type="date" value={report.inspectionDate?.slice(0, 10)} onSave={(v) => patch.mutate({ inspectionDate: v || null })} />
          <Field label="Inspector Name" value={report.inspectorName} onSave={(v) => patch.mutate({ inspectorName: v || null })} />
          <div>
            <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">Inspection Type</span>
            <div className="mt-1 flex flex-wrap gap-4">
              {INSPECTION_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-sm capitalize">
                  <input type="radio" checked={report.inspectionType === t} onChange={() => patch.mutate({ inspectionType: t })} className="print:accent-black" />
                  {t.replace(/_/g, " ")}
                </label>
              ))}
            </div>
          </div>
          <Field label="Part / Material #" value={report.partMaterialNo} onSave={(v) => patch.mutate({ partMaterialNo: v || null })} />
          <Field label="PO / Job #" value={report.poJobNo} onSave={(v) => patch.mutate({ poJobNo: v || null })} />
          <Field label="Supplier / Vendor" value={report.supplierVendor} onSave={(v) => patch.mutate({ supplierVendor: v || null })} />
          <Field label="Batch / Lot #" value={report.batchLotNo} onSave={(v) => patch.mutate({ batchLotNo: v || null })} />
          <Field label="Total Quantity" value={report.totalQuantity} onSave={(v) => patch.mutate({ totalQuantity: v || null })} />
          <Field label="Sample Size" value={report.sampleSize} onSave={(v) => patch.mutate({ sampleSize: v || null })} />
        </div>

        <h2 className="mb-2 mt-6 border-l-4 border-primary bg-muted/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide print:border-black print:bg-transparent print:text-black">
          2. Inspection Checklist &amp; Measured Results
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="bg-foreground text-background print:bg-black print:text-white">
                {["#", "Inspection Parameter", "Specification / Standard", "Actual Finding", "Result"].map((h) => (
                  <th key={h} className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">
                    {h}
                  </th>
                ))}
                <th className="w-8 border border-border print:hidden" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="border border-border px-2 py-2 text-center text-muted-foreground print:border-black">
                    No rows yet.
                  </td>
                </tr>
              )}
              {items.map((item) => (
                <ItemRow key={item.id} item={item} onPatch={(body) => patchItem.mutate({ itemId: item.id, body })} onDelete={() => deleteItem.mutate(item.id)} />
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={() => addItem.mutate()} disabled={addItem.isPending} className="mt-2 rounded-md border border-dashed border-primary px-3 py-1.5 text-xs text-primary hover:bg-primary/10 print:hidden">
          + Add Row
        </button>

        <h2 className="mb-2 mt-6 border-l-4 border-primary bg-muted/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide print:border-black print:bg-transparent print:text-black">
          3. Inspection Summary &amp; Disposition
        </h2>
        <div>
          <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">Final Status</span>
          <div className="mt-1 flex flex-wrap gap-4">
            {FINAL_STATUSES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm capitalize">
                <input type="radio" checked={report.finalStatus === s} onChange={() => patch.mutate({ finalStatus: s })} className="print:accent-black" />
                {s.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </div>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">Notes / Remarks</span>
          <textarea
            defaultValue={report.notesRemarks ?? ""}
            rows={2}
            onBlur={(e) => e.target.value !== (report.notesRemarks ?? "") && patch.mutate({ notesRemarks: e.target.value || null })}
            className="rounded-md border border-form-field bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary print:border-black print:bg-white print:text-black"
          />
        </label>

        <h2 className="mb-2 mt-6 border-l-4 border-primary bg-muted/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide print:border-black print:bg-transparent print:text-black">
          4. Sign-Off
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="bg-foreground text-background print:bg-black print:text-white">
                <th className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">Role</th>
                <th className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">Signature</th>
                <th className="border border-border px-2 py-1.5 text-left text-xs uppercase print:border-black">Date</th>
              </tr>
            </thead>
            <tbody>
              <SignRow label="Inspector" signature={report.inspectorSignature} date={report.inspectorSignatureDate} onSignature={(v) => patch.mutate({ inspectorSignature: v || null })} onDate={(v) => patch.mutate({ inspectorSignatureDate: v || null })} />
              <SignRow label="QA Lead" signature={report.qaLeadSignature} date={report.qaLeadSignatureDate} onSignature={(v) => patch.mutate({ qaLeadSignature: v || null })} onDate={(v) => patch.mutate({ qaLeadSignatureDate: v || null })} />
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-4 print:hidden">
        <AttachmentsPanel entityType="quality_inspection_reports" entityId={reportId} />
        <WorkflowHistoryPanel moduleName="quality_inspection_reports" recordId={reportId} />
      </div>

      <Modal title="Delete Quality Inspection Report" isOpen={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm">Permanently delete this report? This cannot be undone.</p>
          <div className="flex gap-2">
            <button onClick={() => deleteReport.mutate()} disabled={deleteReport.isPending} className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-60">
              {deleteReport.isPending ? "Deleting…" : "Delete permanently"}
            </button>
            <button onClick={() => setDeleteOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, value, onSave, type = "text" }: { label: string; value: string | null | undefined; onSave: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium uppercase text-muted-foreground print:text-black">{label}</span>
      <input
        type={type}
        defaultValue={value ?? ""}
        onBlur={(e) => e.target.value !== (value ?? "") && onSave(e.target.value)}
        className="rounded-md border border-form-field bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary print:border-black print:bg-white print:text-black"
      />
    </label>
  );
}

function ItemRow({ item, onPatch, onDelete }: { item: QualityInspectionItem; onPatch: (body: Record<string, unknown>) => void; onDelete: () => void }) {
  const inputClass = "w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary print:text-black";
  return (
    <tr>
      <td className="border border-border p-0 print:border-black">
        <input type="number" defaultValue={item.itemNumber ?? ""} onBlur={(e) => e.target.value !== (item.itemNumber ?? "") && onPatch({ itemNumber: e.target.value ? Number(e.target.value) : null })} className={inputClass} />
      </td>
      <td className="border border-border p-0 print:border-black">
        <input defaultValue={item.parameter ?? ""} onBlur={(e) => e.target.value !== (item.parameter ?? "") && onPatch({ parameter: e.target.value || null })} className={inputClass} />
      </td>
      <td className="border border-border p-0 print:border-black">
        <input defaultValue={item.specification ?? ""} onBlur={(e) => e.target.value !== (item.specification ?? "") && onPatch({ specification: e.target.value || null })} className={inputClass} />
      </td>
      <td className="border border-border p-0 print:border-black">
        <input defaultValue={item.actualFinding ?? ""} onBlur={(e) => e.target.value !== (item.actualFinding ?? "") && onPatch({ actualFinding: e.target.value || null })} className={inputClass} />
      </td>
      <td className="border border-border p-0 print:border-black">
        <select defaultValue={item.result ?? ""} onChange={(e) => onPatch({ result: e.target.value || null })} className={inputClass}>
          <option value="">—</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
        </select>
      </td>
      <td className="border border-border text-center print:hidden">
        <button onClick={onDelete} title="Remove row" className="px-1 text-muted-foreground hover:text-destructive">
          ✕
        </button>
      </td>
    </tr>
  );
}

function SignRow({ label, signature, date, onSignature, onDate }: { label: string; signature: string | null; date: string | null; onSignature: (v: string) => void; onDate: (v: string) => void }) {
  return (
    <tr>
      <td className="border border-border px-2 py-1.5 print:border-black">{label}</td>
      <td className="border border-border p-0 print:border-black">
        <input defaultValue={signature ?? ""} placeholder="Type name to sign" onBlur={(e) => e.target.value !== (signature ?? "") && onSignature(e.target.value)} className="w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary print:text-black" />
      </td>
      <td className="border border-border p-0 print:border-black">
        <input type="date" defaultValue={date?.slice(0, 10) ?? ""} onBlur={(e) => e.target.value !== (date?.slice(0, 10) ?? "") && onDate(e.target.value)} className="w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary print:text-black" />
      </td>
    </tr>
  );
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useAuthStore } from "../../store/authStore";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { WorkOrder, WorkOrderOperation } from "../../api/types";

/**
 * The Production Work Order traveler — a bespoke, standalone shop-floor
 * document, deliberately built pixel-for-pixel to a real supplied mockup
 * rather than through the shared FormLayout/GenericFormRenderer engine every
 * other QMS document in this app uses (see the Work Order Traveler review —
 * an explicit, confirmed exception; it does not get automatic PDF export
 * the way NCR/CAPA/etc. do, and it looks different from the rest of the app
 * by design). All CSS below is scoped under the wot- prefix so it can't
 * leak into or collide with the rest of the app's styles.
 *
 * Planning fields (Part Number/Revision/Order Qty/Due Date) stay editable
 * only while the work order is "planned" — same rule
 * workOrders.controller.ts's updateWorkOrderHandler already enforces.
 * Shop-floor fields (the operations routing table, quality gates,
 * signatures) stay editable through "in_progress"/"completed" and only lock
 * once the work order is "cancelled" — see assertTravelerEditable there.
 */
export function ProductionWorkOrderTraveler({ workOrder }: { workOrder: WorkOrder }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const logoUrl = useAuthStore((s) => s.tenant?.branding?.logoUrl);

  const canEditPlanning = workOrder.status === "planned";
  const canEditTraveler = workOrder.status !== "cancelled";

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["work-orders", workOrder.id] });

  const patchPlanning = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiClient.patch(`/work-orders/${workOrder.id}`, body)).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update — only while planned.")),
  });

  const patchQualityGates = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiClient.patch(`/work-orders/${workOrder.id}/quality-gates`, body)).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update the quality gate.")),
  });

  const signOperator = useMutation({
    mutationFn: async (signature: string) => (await apiClient.post(`/work-orders/${workOrder.id}/sign-operator`, { signature })).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't record the operator signature.")),
  });

  const signInspector = useMutation({
    mutationFn: async (signature: string) => (await apiClient.post(`/work-orders/${workOrder.id}/sign-inspector`, { signature })).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't record the inspector signature.")),
  });

  const addOperation = useMutation({
    mutationFn: async () => {
      const nextOp = Math.max(0, ...(workOrder.operations ?? []).map((o) => o.opNumber)) + 10;
      return (await apiClient.post(`/work-orders/${workOrder.id}/operations`, { opNumber: nextOp, description: "New operation" })).data;
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add that operation.")),
  });

  const patchOperation = useMutation({
    mutationFn: async ({ opId, body }: { opId: number; body: Record<string, unknown> }) => (await apiClient.patch(`/work-orders/${workOrder.id}/operations/${opId}`, body)).data,
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update that operation.")),
  });

  const deleteOperation = useMutation({
    mutationFn: async (opId: number) => apiClient.delete(`/work-orders/${workOrder.id}/operations/${opId}`),
    onSuccess: invalidate,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't remove that operation.")),
  });

  const operations = [...(workOrder.operations ?? [])].sort((a, b) => a.opNumber - b.opNumber);

  return (
    <div className="wot-scope">
      <style>{`
        .wot-scope { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; color-scheme: light; }
        .wot-work-order { max-width: 800px; margin: 0 auto; border: 2px solid #0f1423; padding: 24px; border-radius: 8px; background: #fff; }
        .wot-header { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, #0f1423 0%, #1a1b35 100%); color: white; padding: 16px 20px; border-radius: 6px; border-bottom: 4px solid #00f2fe; flex-wrap: wrap; gap: 12px; }
        .wot-header-left { display: flex; align-items: center; gap: 16px; }
        .wot-logo { width: 60px; height: 60px; border-radius: 8px; border: 1px solid #00f2fe; object-fit: cover; display: flex; align-items: center; justify-content: center; background: #1a1b35; font-weight: bold; color: #00f2fe; font-size: 20px; }
        .wot-title-area h1 { margin: 0; font-size: 22px; letter-spacing: 1px; color: #fff; }
        .wot-title-area p { margin: 4px 0 0 0; font-size: 11px; color: #00f2fe; text-transform: uppercase; }
        .wot-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
        .wot-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 16px; }
        @media (max-width: 480px) { .wot-grid-4 { grid-template-columns: 1fr 1fr; } }
        .wot-section-title { background: #f1f5f9; border-left: 4px solid #9d4edd; padding: 6px 12px; font-size: 13px; font-weight: bold; text-transform: uppercase; color: #0f1423; margin-bottom: 8px; }
        .wot-field-group { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .wot-field-label { font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase; }
        .wot-field-value { border-bottom: 1px dashed #cbd5e1; min-height: 20px; font-size: 13px; }
        .wot-field-input { border: none; border-bottom: 1px dashed #cbd5e1; background: transparent; font-size: 13px; width: 100%; padding: 0 0 2px 0; font-family: inherit; color: #1e293b; }
        .wot-field-input:disabled { color: #94a3b8; border-bottom-style: dotted; }
        .wot-field-input:focus { outline: none; border-bottom-color: #9d4edd; }
        .wot-table-wrap { overflow-x: auto; }
        .wot-scope table { width: 100%; border-collapse: collapse; margin-top: 16px; min-width: 560px; }
        .wot-scope th { background: #0f1423; color: #fff; font-size: 11px; text-transform: uppercase; padding: 8px; text-align: left; border-bottom: 2px solid #00f2fe; }
        .wot-scope td { border: 1px solid #e2e8f0; padding: 6px 8px; font-size: 12px; }
        .wot-cell-input { border: none; background: transparent; font-size: 12px; width: 100%; font-family: inherit; color: #1e293b; }
        .wot-cell-input:focus { outline: 1px solid #9d4edd; }
        .wot-checkbox-group { display: flex; gap: 12px; align-items: center; }
        .wot-square-box { width: 14px; height: 14px; border: 1.5px solid #0f1423; display: inline-flex; align-items: center; justify-content: center; border-radius: 2px; cursor: pointer; flex-shrink: 0; accent-color: #0f1423; }
        .wot-sign-off-block { margin-top: 20px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; }
        .wot-remove-op { border: none; background: transparent; color: #94a3b8; cursor: pointer; font-size: 14px; line-height: 1; padding: 2px 4px; }
        .wot-remove-op:hover { color: #dc2626; }
        .wot-add-op { margin-top: 10px; border: 1px dashed #9d4edd; background: transparent; color: #9d4edd; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
        .wot-add-op:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>

      <div className="wot-work-order">
        <div className="wot-header">
          <div className="wot-header-left">
            {logoUrl ? <img className="wot-logo" src={logoUrl} alt="Logo" /> : <div className="wot-logo">AQ</div>}
            <div className="wot-title-area">
              <h1>PRODUCTION WORK ORDER</h1>
              <p>Shop Floor Controlled Document</p>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>WO NUMBER</div>
            <div style={{ fontSize: 20, fontWeight: "bold", color: "#00f2fe" }}>#WO-{workOrder.id}</div>
          </div>
        </div>

        <div className="wot-grid-4">
          <div className="wot-field-group">
            <span className="wot-field-label">Part Number</span>
            <div className="wot-field-value">{workOrder.item?.sku ?? `Item #${workOrder.itemId}`}</div>
          </div>
          <div className="wot-field-group">
            <span className="wot-field-label">Revision</span>
            <input
              className="wot-field-input"
              defaultValue={workOrder.revision ?? ""}
              disabled={!canEditPlanning}
              placeholder={canEditPlanning ? "REV A" : "—"}
              title={canEditPlanning ? undefined : "Only editable while planned"}
              onBlur={(e) => e.target.value !== (workOrder.revision ?? "") && patchPlanning.mutate({ revision: e.target.value || null })}
            />
          </div>
          <div className="wot-field-group">
            <span className="wot-field-label">Order Qty</span>
            <input
              className="wot-field-input"
              type="number"
              min="0"
              step="any"
              defaultValue={workOrder.quantityPlanned}
              disabled={!canEditPlanning}
              title={canEditPlanning ? undefined : "Only editable while planned"}
              onBlur={(e) => Number(e.target.value) !== Number(workOrder.quantityPlanned) && e.target.value && patchPlanning.mutate({ quantityPlanned: Number(e.target.value) })}
            />
          </div>
          <div className="wot-field-group">
            <span className="wot-field-label">Due Date</span>
            <input
              className="wot-field-input"
              type="date"
              defaultValue={workOrder.dueDate ? workOrder.dueDate.slice(0, 10) : ""}
              disabled={!canEditPlanning}
              title={canEditPlanning ? undefined : "Only editable while planned"}
              onBlur={(e) => e.target.value !== (workOrder.dueDate?.slice(0, 10) ?? "") && patchPlanning.mutate({ dueDate: e.target.value || null })}
            />
          </div>
        </div>

        <div className="wot-table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "8%" }}>Op #</th>
                <th style={{ width: "30%" }}>Operation Description</th>
                <th style={{ width: "20%" }}>Work Center</th>
                <th style={{ width: "15%" }}>Completed Qty</th>
                <th style={{ width: "22%" }}>Sign-off / Date</th>
                <th style={{ width: "5%" }}></th>
              </tr>
            </thead>
            <tbody>
              {operations.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "#94a3b8" }}>
                    No operations yet — Add Operation below.
                  </td>
                </tr>
              )}
              {operations.map((op) => (
                <OperationRow key={op.id} op={op} canEdit={canEditTraveler} onPatch={(body) => patchOperation.mutate({ opId: op.id, body })} onDelete={() => deleteOperation.mutate(op.id)} />
              ))}
            </tbody>
          </table>
        </div>
        <button className="wot-add-op" onClick={() => addOperation.mutate()} disabled={!canEditTraveler || addOperation.isPending}>
          + Add Operation
        </button>

        <div className="wot-sign-off-block">
          <div className="wot-section-title">Quality Gates (Paper Sign-Off)</div>
          <div className="wot-grid-2" style={{ marginTop: 12 }}>
            <label className="wot-checkbox-group" style={{ cursor: canEditTraveler ? "pointer" : "default" }}>
              <input
                type="checkbox"
                className="wot-square-box"
                checked={workOrder.firstPieceInspectionPassed}
                disabled={!canEditTraveler}
                onChange={(e) => patchQualityGates.mutate({ firstPieceInspectionPassed: e.target.checked })}
              />
              <span style={{ fontSize: 12 }}>
                <strong>First-Piece Inspection:</strong> Passed &amp; Verified
              </span>
            </label>
            <label className="wot-checkbox-group" style={{ cursor: canEditTraveler ? "pointer" : "default" }}>
              <input
                type="checkbox"
                className="wot-square-box"
                checked={workOrder.finalQcInspectionPassed}
                disabled={!canEditTraveler}
                onChange={(e) => patchQualityGates.mutate({ finalQcInspectionPassed: e.target.checked })}
              />
              <span style={{ fontSize: 12 }}>
                <strong>Final QC Inspection:</strong> Passed &amp; Verified
              </span>
            </label>
          </div>
        </div>

        <div className="wot-grid-2" style={{ marginTop: 24 }}>
          <SignatureField
            label="Operator Signature"
            value={workOrder.operatorSignature}
            signedAt={workOrder.operatorSignedAt}
            canEdit={canEditTraveler}
            onSign={(name) => signOperator.mutate(name)}
          />
          <SignatureField
            label="Inspector Signature"
            value={workOrder.inspectorSignature}
            signedAt={workOrder.inspectorSignedAt}
            canEdit={canEditTraveler}
            onSign={(name) => signInspector.mutate(name)}
          />
        </div>
      </div>
    </div>
  );
}

function OperationRow({
  op,
  canEdit,
  onPatch,
  onDelete,
}: {
  op: WorkOrderOperation;
  canEdit: boolean;
  onPatch: (body: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [signOffDraft, setSignOffDraft] = useState(op.signOff ?? "");

  return (
    <tr>
      <td>
        <input className="wot-cell-input" type="number" defaultValue={op.opNumber} disabled={!canEdit} onBlur={(e) => Number(e.target.value) !== op.opNumber && onPatch({ opNumber: Number(e.target.value) })} />
      </td>
      <td>
        <input className="wot-cell-input" defaultValue={op.description} disabled={!canEdit} onBlur={(e) => e.target.value !== op.description && e.target.value && onPatch({ description: e.target.value })} />
      </td>
      <td>
        <input className="wot-cell-input" defaultValue={op.workCenter ?? ""} disabled={!canEdit} onBlur={(e) => e.target.value !== (op.workCenter ?? "") && onPatch({ workCenter: e.target.value || null })} />
      </td>
      <td>
        <input
          className="wot-cell-input"
          type="number"
          min="0"
          step="any"
          defaultValue={op.completedQty ?? ""}
          disabled={!canEdit}
          onBlur={(e) => e.target.value !== (op.completedQty ?? "") && onPatch({ completedQty: e.target.value ? Number(e.target.value) : null })}
        />
      </td>
      <td>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <input
            className="wot-cell-input"
            placeholder="Name"
            value={signOffDraft}
            disabled={!canEdit}
            onChange={(e) => setSignOffDraft(e.target.value)}
            onBlur={() => signOffDraft !== (op.signOff ?? "") && onPatch({ signOff: signOffDraft || null })}
          />
          {op.signOffDate && <span style={{ fontSize: 10, color: "#64748b" }}>{new Date(op.signOffDate).toLocaleDateString()}</span>}
        </div>
      </td>
      <td>
        {canEdit && (
          <button className="wot-remove-op" onClick={onDelete} title="Remove operation">
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}

function SignatureField({
  label,
  value,
  signedAt,
  canEdit,
  onSign,
}: {
  label: string;
  value: string | null;
  signedAt: string | null;
  canEdit: boolean;
  onSign: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");

  return (
    <div className="wot-field-group">
      <span className="wot-field-label">{label}</span>
      <input
        className="wot-field-input"
        style={{ height: 24 }}
        value={draft}
        disabled={!canEdit}
        placeholder={canEdit ? "Type name to sign" : "—"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== (value ?? "") && draft.trim() && onSign(draft.trim())}
      />
      {signedAt && (
        <span style={{ fontSize: 10, color: "#64748b" }}>
          Signed {new Date(signedAt).toLocaleString()}
        </span>
      )}
    </div>
  );
}

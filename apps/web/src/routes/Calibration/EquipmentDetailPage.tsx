import { useRef } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip } from "lucide-react";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { STATUS_COLORS, calibrationStatusFromDueDate } from "../../components/forms/formulas";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";

interface Equipment {
  id: number;
  name: string;
  serialNumber: string | null;
  location: string | null;
  calibrationIntervalDays: number;
}

interface CalibrationEvent {
  id: number;
  performedAt: string;
  result: string | null;
  technicianName: string | null;
  notes: string | null;
  nextDueAt: string | null;
  certificatePath: string | null;
}

const equipmentHooks = createResourceHooks<Equipment>("equipment");

function useUploadCertificate(equipmentId: number) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ calibrationId, file }: { calibrationId: number; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return (await apiClient.post(`/equipment/calibration/${calibrationId}/certificate`, form)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment", equipmentId, "calibration"] });
      // Certificate uploads log against the equipment, not the individual
      // calibration event (see calibration.controller.ts) — same key this
      // page's WorkflowHistoryPanel reads.
      queryClient.invalidateQueries({ queryKey: ["workflow-history", "calibration", equipmentId] });
      toast.success("Certificate attached.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't attach this certificate.")),
  });
}

/**
 * Equipment detail: calibration history plus the three fillable documents
 * scoped to this asset. The "Calibration Record" form (formType:
 * "calibration") is the single source of truth for a new calibration event —
 * clicking its "Log Calibration Event" button (form.data's "Save version"
 * action, see FormEditor.tsx) is what actually writes a row here and moves
 * the due-date/status color, not a separate quick-entry form that used to
 * live on this page and could drift out of sync with it.
 */
export function EquipmentDetailPage() {
  const { id } = useParams();
  const equipmentId = Number(id);
  const { data: equipment, isLoading } = equipmentHooks.useOne(equipmentId);
  useSetAssistantContext("calibration", equipmentId, equipment ? equipment.name : `Equipment #${equipmentId}`);
  const uploadCertificate = useUploadCertificate(equipmentId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadTarget = useRef<number | null>(null);

  const { data: calibrations = [] } = useQuery<CalibrationEvent[]>({
    queryKey: ["equipment", equipmentId, "calibration"],
    queryFn: async () => (await apiClient.get(`/equipment/${equipmentId}/calibration`)).data,
  });

  const latest = calibrations.length
    ? calibrations.reduce((a, b) => (new Date(a.performedAt) > new Date(b.performedAt) ? a : b))
    : null;
  const statusLabel = calibrationStatusFromDueDate(latest?.nextDueAt);
  const statusColors = STATUS_COLORS[statusLabel] ?? { bg: "#EAEAE6", fg: "#66655D" };

  function requestUpload(calibrationId: number) {
    pendingUploadTarget.current = calibrationId;
    fileInputRef.current?.click();
  }

  async function viewCertificate(calibrationId: number) {
    const res = await apiClient.get(`/equipment/calibration/${calibrationId}/certificate`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  if (isLoading || !equipment) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const calibrationId = pendingUploadTarget.current;
          if (file && calibrationId != null) uploadCertificate.mutate({ calibrationId, file });
          e.target.value = "";
          pendingUploadTarget.current = null;
        }}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{equipment.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{equipment.serialNumber ?? "No serial #"}</span>
            <span>— {equipment.location ?? "No location"}</span>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: statusColors.bg, color: statusColors.fg }}
            >
              {statusLabel}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenFormButton formType="calibration" entityId={equipment.id} title={`Equipment #${equipment.id} — Calibration Record`} label="Calibration Record" />
          <OpenFormButton formType="maintenance_work_order" entityId={equipment.id} title={`Equipment #${equipment.id} — Maintenance Work Order`} label="Maintenance Work Order" />
          <OpenFormButton formType="gage_rr" entityId={equipment.id} title={`Equipment #${equipment.id} — Gage R&R Study`} label="Gage R&R Study" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Calibration History</h2>
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground">
              Open "Calibration Record" above, fill it in, then click <span className="font-medium">Log Calibration Event</span> to add a row here.
            </p>
            <AiFieldAssistant
              module="calibration"
              recordId={equipmentId}
              triggerLabel="AI Calibration Summary"
              buildInitialPrompt={() =>
                `Summarize the calibration status for equipment "${equipment.name}" using the history and interval provided. Note whether` +
                " it's on track or overdue, call out any pattern across past results (e.g. repeated adjustments or failures), and suggest" +
                " next steps."
              }
            />
          </div>
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          {calibrations.length === 0 && <li className="text-muted-foreground">No calibration events logged yet.</li>}
          {calibrations
            .slice()
            .sort((a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime())
            .map((c) => (
              <li key={c.id} className="flex flex-col gap-1 border-b border-border pb-2">
                <div className="flex items-center gap-3">
                  <span className="w-24 flex-none">{new Date(c.performedAt).toLocaleDateString()}</span>
                  <span className="w-20 flex-none capitalize">{c.result ?? "—"}</span>
                  <span className="flex-1 text-muted-foreground">{c.technicianName ?? "No technician recorded"}</span>
                  <span className="flex-none text-muted-foreground">Next due: {c.nextDueAt ? new Date(c.nextDueAt).toLocaleDateString() : "—"}</span>
                  {c.certificatePath ? (
                    <button onClick={() => viewCertificate(c.id)} className="flex-none text-primary hover:opacity-80" aria-label="View certificate">
                      <FileText size={14} />
                    </button>
                  ) : (
                    <button onClick={() => requestUpload(c.id)} className="flex-none text-muted-foreground hover:text-primary" aria-label="Attach certificate">
                      <Paperclip size={14} />
                    </button>
                  )}
                </div>
                {c.notes && <p className="pl-24 text-xs text-muted-foreground">{c.notes}</p>}
              </li>
            ))}
        </ul>
      </div>

      <WorkflowHistoryPanel moduleName="calibration" recordId={equipmentId} />
    </div>
  );
}

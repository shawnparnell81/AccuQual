import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip } from "lucide-react";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { PrintFormButton } from "../../components/forms/PrintFormButton";
import { GenericCreateForm, type FieldSpec } from "../../components/forms/GenericCreateForm";
import { Modal } from "../../components/modals/Modal";
import { EquipmentStatusBadge, EquipmentStatusModal, LinkedDocumentsPanel, ScheduleCalibrationModal, useMayEditEquipment, type EquipmentState } from "../../components/calibration/EquipmentPanels";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { FileDropZone } from "../../components/shared/FileDropZone";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";

interface Equipment extends EquipmentState {
  serialNumber: string | null;
  location: string | null;
  type: string | null;
  calibrationIntervalDays: number;
}

interface CalibrationEvent {
  id: number;
  /** Null while the calibration is only scheduled. */
  performedAt: string | null;
  status: "scheduled" | "completed" | "failed";
  scheduledAt: string | null;
  results: Record<string, unknown> | null;
  result: string | null;
  technicianName: string | null;
  notes: string | null;
  nextDueAt: string | null;
  certificatePath: string | null;
}

const equipmentHooks = createResourceHooks<Equipment>("equipment");

const eventTime = (c: CalibrationEvent) => new Date(c.performedAt ?? c.scheduledAt ?? 0).getTime();

// Same field set as CalibrationPage.tsx's createFields — kept in one place
// per page rather than shared, matching every other module's list-page vs.
// detail-page field-spec split in this app (e.g. Feasibility).
const EQUIPMENT_FIELDS: FieldSpec[] = [
  { name: "name", label: "Equipment name" },
  { name: "type", label: "Type (caliper, torque wrench, scale…)" },
  { name: "serialNumber", label: "Serial number" },
  { name: "location", label: "Location" },
  { name: "calibrationIntervalDays", label: "Calibration interval (days)", type: "number" },
];

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
  const navigate = useNavigate();
  const toast = useToast();
  const { data: equipment, isLoading, isError } = equipmentHooks.useOne(equipmentId);
  useSetAssistantContext("calibration", equipmentId, equipment ? equipment.name : `Equipment #${equipmentId}`);
  const uploadCertificate = useUploadCertificate(equipmentId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadTarget = useRef<number | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const { mayEdit } = useMayEditEquipment();
  const queryClient = useQueryClient();
  const cancelSchedule = useMutation({
    mutationFn: async (calibrationId: number) => apiClient.delete(`/equipment/calibration/${calibrationId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["equipment"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-history", "calibration", equipmentId] });
      toast.success("Scheduled calibration cancelled.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't cancel it.")),
  });
  const updateEquipment = equipmentHooks.useUpdate();
  const deleteEquipment = equipmentHooks.useDelete();

  const { data: calibrations = [] } = useQuery<CalibrationEvent[]>({
    queryKey: ["equipment", equipmentId, "calibration"],
    queryFn: async () => (await apiClient.get(`/equipment/${equipmentId}/calibration`)).data,
  });

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

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
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
            {equipment.type && <span>{equipment.type} —</span>}
            <span>{equipment.serialNumber ?? "No serial #"}</span>
            <span>— {equipment.location ?? "No location"}</span>
            <EquipmentStatusBadge status={equipment.status} dueStatus={equipment.dueStatus} />
            {equipment.nextDueAt && equipment.status !== "out_of_service" && <span>· next due {new Date(equipment.nextDueAt).toLocaleDateString()}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <OpenFormButton formType="calibration" entityId={equipment.id} title={`Equipment #${equipment.id} — Calibration Record`} label="Calibration Record" />
          <PrintFormButton formType="calibration" entityId={equipment.id} label="Print Record" />
          <OpenFormButton formType="maintenance_work_order" entityId={equipment.id} title={`Equipment #${equipment.id} — Maintenance Work Order`} label="Maintenance Work Order" />
          <PrintFormButton formType="maintenance_work_order" entityId={equipment.id} label="Print WO" />
          <OpenFormButton formType="gage_rr" entityId={equipment.id} title={`Equipment #${equipment.id} — Gage R&R Study`} label="Gage R&R Study" />
          <PrintFormButton formType="gage_rr" entityId={equipment.id} label="Print R&R" />
          {mayEdit && (
            <>
              <button onClick={() => setScheduleOpen(true)} disabled={equipment.status === "inactive" || !!equipment.scheduledCalibrationId} title={equipment.scheduledCalibrationId ? "A calibration is already scheduled" : undefined} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">
                Schedule calibration
              </button>
              <button onClick={() => setStatusOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
                Change status
              </button>
            </>
          )}
          <button onClick={() => setEditOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Edit
          </button>
          <button onClick={() => setDeleteOpen(true)} className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10">
            Delete
          </button>
        </div>
      </div>

      {equipment.status === "out_of_service" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive">Out of service — do not use.</p>
          <p className="text-xs">
            {equipment.statusReason ?? "No reason recorded."}
            {equipment.statusCause === "calibration_failure" && " It returns to service automatically when a calibration passes; an admin or quality manager can override that with a recorded reason."}
          </p>
        </div>
      )}
      {equipment.dueStatus === "failed" && equipment.status !== "out_of_service" && <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">The latest calibration failed. It needs a passing calibration.</p>}
      {equipment.nextScheduledAt && (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs">
          Calibration scheduled for <strong>{new Date(equipment.nextScheduledAt).toLocaleDateString()}</strong>
          {equipment.scheduleOverdue ? " — that date has passed and it has not been logged." : "."} Log it with the Calibration Record to complete it.
        </p>
      )}

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
            .sort((a, b) => eventTime(b) - eventTime(a))
            .map((c) => (
              <li key={c.id} className="border-b border-border pb-2">
                <FileDropZone
                  className="flex flex-col gap-1"
                  accept="application/pdf"
                  multiple={false}
                  disabled={c.status === "scheduled" || !!c.certificatePath || uploadCertificate.isPending}
                  label="Drop the certificate (PDF) to attach it"
                  onFiles={(dropped) => uploadCertificate.mutate({ calibrationId: c.id, file: dropped[0]! })}
                >
                <div className="flex items-center gap-3">
                  <span className="w-24 flex-none">{c.performedAt ? new Date(c.performedAt).toLocaleDateString() : c.scheduledAt ? new Date(c.scheduledAt).toLocaleDateString() : "—"}</span>
                  <span className={`w-20 flex-none capitalize ${c.status === "failed" ? "font-semibold text-destructive" : ""}`}>{c.status === "scheduled" ? "Scheduled" : (c.result ?? "—")}</span>
                  <span className="flex-1 text-muted-foreground">{c.technicianName ?? "No technician recorded"}</span>
                  <span className="flex-none text-muted-foreground">Next due: {c.nextDueAt ? new Date(c.nextDueAt).toLocaleDateString() : "—"}</span>
                  {c.status === "scheduled" ? (
                    mayEdit ? (
                      <button onClick={() => { if (confirm("Cancel this scheduled calibration?")) cancelSchedule.mutate(c.id); }} className="flex-none text-xs text-muted-foreground hover:text-destructive">
                        Cancel
                      </button>
                    ) : null
                  ) : c.certificatePath ? (
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
                {c.results && Object.keys(c.results).length > 0 && <p className="pl-24 text-xs text-muted-foreground">Readings: {JSON.stringify(c.results)}</p>}
                </FileDropZone>
              </li>
            ))}
        </ul>
        {calibrations.some((c) => c.status !== "scheduled" && !c.certificatePath) && (
          <p className="mt-2 text-xs text-muted-foreground">Tip: drag a certificate PDF from your computer onto a calibration row to attach it.</p>
        )}
      </div>

      <LinkedDocumentsPanel equipmentId={equipmentId} />
      <AttachmentsPanel entityType="calibration" entityId={equipmentId} />
      <WorkflowHistoryPanel moduleName="calibration" recordId={equipmentId} />

      <ScheduleCalibrationModal equipmentId={equipmentId} isOpen={scheduleOpen} onClose={() => setScheduleOpen(false)} />
      <EquipmentStatusModal key={equipment.status} equipment={equipment} isOpen={statusOpen} onClose={() => setStatusOpen(false)} />

      <Modal title="Edit Equipment" isOpen={editOpen} onClose={() => setEditOpen(false)}>
        <GenericCreateForm
          fields={EQUIPMENT_FIELDS}
          initialValues={equipment as unknown as Record<string, unknown>}
          submitLabel="Save changes"
          onSubmit={(values) =>
            updateEquipment.mutate(
              { id: equipmentId, ...values },
              {
                onSuccess: () => {
                  setEditOpen(false);
                  toast.success("Equipment updated.");
                },
                onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update this equipment.")),
              }
            )
          }
        />
      </Modal>

      <Modal title="Delete Equipment" isOpen={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-sm">Permanently delete "{equipment.name}"? This cannot be undone.</p>
          <div className="flex gap-2">
            <button
              onClick={() =>
                deleteEquipment.mutate(equipmentId, {
                  onSuccess: () => {
                    toast.success("Equipment deleted.");
                    navigate("/calibration");
                  },
                  // The backend rejects this with a 400 (not a 500) when
                  // real calibration history still references this
                  // equipment (see calibration.controller.ts's
                  // removeEquipmentHandler) — surfaced here exactly like
                  // any other validation error, not a generic failure.
                  onError: (err) => toast.error(extractErrorMessage(err, "Couldn't delete this equipment.")),
                })
              }
              disabled={deleteEquipment.isPending}
              className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-60"
            >
              {deleteEquipment.isPending ? "Deleting…" : "Delete permanently"}
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

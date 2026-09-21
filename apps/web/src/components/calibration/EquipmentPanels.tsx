import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Mail } from "lucide-react";
import { apiClient } from "../../api/client";
import { STATUS_COLORS } from "../forms/formulas";
import { Modal } from "../modals/Modal";
import { TextAreaField, TextField, SelectField } from "../forms/Field";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { REVIEWER_ROLES } from "../../api/versioning";
import { useCurrentUser } from "../../hooks/useAuth";

export type EquipmentStatus = "active" | "inactive" | "out_of_service";
export type DueStatus = "failed" | "overdue" | "due_soon" | "upcoming" | "current" | "uncalibrated";

/** Fields the API adds to every equipment row (calibration.service.ts). */
export interface EquipmentState {
  id: number;
  name: string;
  status: EquipmentStatus;
  statusReason: string | null;
  statusCause: "calibration_failure" | "manual" | null;
  dueStatus: DueStatus;
  nextDueAt: string | null;
  lastResult: string | null;
  scheduledCalibrationId: number | null;
  nextScheduledAt: string | null;
  scheduleOverdue: boolean;
}

const DUE_LABEL: Record<DueStatus, string> = { failed: "Past Due", overdue: "Past Due", due_soon: "Due Within 30 Days", upcoming: "Due Within 60 Days", current: "Current", uncalibrated: "Never Calibrated" };

/** Where a piece of equipment stands: out of service / inactive outrank the calibration due status. */
export function EquipmentStatusBadge({ status, dueStatus }: { status: EquipmentStatus; dueStatus: DueStatus }) {
  const label = status === "out_of_service" ? "Out of Service" : status === "inactive" ? "Inactive" : dueStatus === "failed" ? "Calibration Failed" : DUE_LABEL[dueStatus];
  const colors = status === "out_of_service" || dueStatus === "failed" ? STATUS_COLORS["Past Due"]! : (STATUS_COLORS[status === "inactive" ? "Inactive" : DUE_LABEL[dueStatus]] ?? { bg: "#EAEAE6", fg: "#66655D" });
  return (
    <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: colors.bg, color: colors.fg }}>
      {label}
    </span>
  );
}

/** May this person change equipment? The server decides; this only decides which buttons to show. */
export function useMayEditEquipment() {
  const user = useCurrentUser();
  const reviewer = !!user?.roleName && REVIEWER_ROLES.includes(user.roleName);
  return { mayEdit: reviewer || user?.department === "quality", mayOverride: reviewer };
}

// ---- Schedule a calibration ------------------------------------------------------------------------------------------------------------------------

export function ScheduleCalibrationModal({ equipmentId, isOpen, onClose }: { equipmentId: number; isOpen: boolean; onClose: () => void }) {
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();
  const toast = useToast();
  const schedule = useMutation({
    mutationFn: async () => (await apiClient.post(`/equipment/${equipmentId}/calibration`, { scheduledAt: date, notes: notes || undefined })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["equipment"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-history", "calibration", equipmentId] });
      toast.success("Calibration scheduled.");
      setDate("");
      setNotes("");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't schedule the calibration.")),
  });
  return (
    <Modal title="Schedule a calibration" isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <TextField label="Planned date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <TextAreaField label="Notes (optional)" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <p className="text-xs text-muted-foreground">When it is done, log it with the Calibration Record — that completes this schedule.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button disabled={!date || schedule.isPending} onClick={() => schedule.mutate()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {schedule.isPending ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Change status ---------------------------------------------------------------------------------------------------------------------------------

const STATUS_LABEL: Record<EquipmentStatus, string> = { active: "Active (in use)", inactive: "Inactive (retired / not in use)", out_of_service: "Out of service (must not be used)" };

export function EquipmentStatusModal({ equipment, isOpen, onClose }: { equipment: EquipmentState; isOpen: boolean; onClose: () => void }) {
  const options = (Object.keys(STATUS_LABEL) as EquipmentStatus[]).filter((s) => s !== equipment.status);
  const [target, setTarget] = useState<EquipmentStatus>(options[0]!);
  const [reason, setReason] = useState("");
  const { mayOverride } = useMayEditEquipment();
  const queryClient = useQueryClient();
  const toast = useToast();
  const failureHold = equipment.status === "out_of_service" && equipment.statusCause === "calibration_failure";
  const needsReason = target === "out_of_service" || equipment.status === "out_of_service";
  const blocked = failureHold && target === "active" && !mayOverride;

  const change = useMutation({
    mutationFn: async () => (await apiClient.post(`/equipment/${equipment.id}/status`, { status: target, reason: reason || undefined })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["equipment"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-history", "calibration", equipment.id] });
      toast.success("Status updated.");
      setReason("");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't change the status.")),
  });

  return (
    <Modal title={`Change status — ${equipment.name}`} isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <SelectField label="New status" value={target} onChange={(e) => setTarget(e.target.value as EquipmentStatus)}>
          {options.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </SelectField>
        {failureHold && target === "active" && (
          <p className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />A failed calibration took this out of service. It returns by itself when a calibration passes.
            {mayOverride ? " You can override that here; the override and your reason are recorded." : " Only an admin or quality manager can override that without a passing calibration."}
          </p>
        )}
        <TextAreaField label={needsReason ? "Reason (required)" : "Reason (optional)"} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={target === "out_of_service" ? "What is wrong with it?" : "Why is it safe to use again?"} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button disabled={blocked || change.isPending || (needsReason && reason.trim().length < 5)} onClick={() => change.mutate()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {change.isPending ? "Saving…" : failureHold && target === "active" ? "Override and return to service" : "Change status"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Attention strip for the list page -------------------------------------------------------------------------------------------------------------

interface AttentionItem {
  id: number;
  name: string;
  reason: "out_of_service" | "failed" | "overdue" | "due_soon" | "schedule_overdue";
  nextDueAt: string | null;
}
const REASON_LABEL: Record<AttentionItem["reason"], string> = { out_of_service: "Out of service", failed: "Failed calibration", overdue: "Overdue", schedule_overdue: "Scheduled, not done", due_soon: "Due within 30 days" };

/** What needs a person's attention now, with a button that emails the same list to the Quality department. */
export function AttentionStrip() {
  const { mayEdit } = useMayEditEquipment();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data = [] } = useQuery<AttentionItem[]>({ queryKey: ["equipment", "attention"], queryFn: async () => (await apiClient.get("/equipment/attention")).data });
  const digest = useMutation({
    mutationFn: async () => (await apiClient.post("/equipment/notify-due")).data as { items: number; notified: number },
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["equipment", "attention"] });
      toast.success(r.items === 0 ? "Nothing needs attention." : `Sent to ${r.notified} ${r.notified === 1 ? "person" : "people"} in Quality.`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't send the digest.")),
  });
  if (data.length === 0) return null;
  const counts = data.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.reason]: (acc[i.reason] ?? 0) + 1 }), {});
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle size={15} /> {data.length} {data.length === 1 ? "item needs" : "items need"} attention
        </p>
        <span className="text-xs text-muted-foreground">{(Object.keys(REASON_LABEL) as AttentionItem["reason"][]).filter((r) => counts[r]).map((r) => `${counts[r]} ${REASON_LABEL[r].toLowerCase()}`).join(" · ")}</span>
        {mayEdit && (
          <button onClick={() => digest.mutate()} disabled={digest.isPending} className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-60">
            <Mail size={12} /> Email this to Quality
          </button>
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {data.slice(0, 8).map((i) => (
          <li key={i.id}>
            <Link to={`/calibration/${i.id}`} className="text-primary hover:underline">
              {i.name}
            </Link>{" "}
            <span className="text-muted-foreground">— {REASON_LABEL[i.reason]}</span>
          </li>
        ))}
        {data.length > 8 && <li className="text-muted-foreground">…and {data.length - 8} more</li>}
      </ul>
    </div>
  );
}

// ---- Documents that link to this equipment ---------------------------------------------------------------------------------------------------------

/** Read-only: released documents (SOPs, calibration procedures) whose current revision links to this equipment. Hidden when the user can't see documents. */
export function LinkedDocumentsPanel({ equipmentId }: { equipmentId: number }) {
  const { data, isError } = useQuery<{ id: number; title: string; revisionCode: string | null }[]>({
    queryKey: ["documents", "linked", "equipment", equipmentId],
    queryFn: async () => (await apiClient.get("/documents/linked", { params: { type: "equipment", id: equipmentId } })).data,
    retry: false,
  });
  if (isError || !data || data.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-medium">Controlled documents for this equipment</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {data.map((d) => (
          <li key={d.id}>
            <Link to={`/documents/${d.id}`} className="text-primary hover:underline">
              {d.title}
            </Link>{" "}
            <span className="text-xs text-muted-foreground">{d.revisionCode ?? ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

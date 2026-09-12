import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { TextField, SelectField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { STATUS_COLORS, calibrationStatusFromDueDate } from "../../components/forms/formulas";

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
  nextDueAt: string | null;
  certificateUrl: string | null;
}

const equipmentHooks = createResourceHooks<Equipment>("equipment");

/**
 * Equipment detail: calibration history (quick entry) plus the three
 * fillable documents scoped to this asset — the per-event Calibration
 * form, an Asset Maintenance Work Order, and a Gage R&R measurement-system
 * study.
 */
export function EquipmentDetailPage() {
  const { id } = useParams();
  const equipmentId = Number(id);
  const { data: equipment, isLoading } = equipmentHooks.useOne(equipmentId);
  const queryClient = useQueryClient();

  const { data: calibrations = [] } = useQuery<CalibrationEvent[]>({
    queryKey: ["equipment", equipmentId, "calibration"],
    queryFn: async () => (await apiClient.get(`/equipment/${equipmentId}/calibration`)).data,
  });

  const latest = calibrations.length
    ? calibrations.reduce((a, b) => (new Date(a.performedAt) > new Date(b.performedAt) ? a : b))
    : null;
  const statusLabel = calibrationStatusFromDueDate(latest?.nextDueAt);
  const statusColors = STATUS_COLORS[statusLabel] ?? { bg: "#EAEAE6", fg: "#66655D" };

  const [entry, setEntry] = useState({ performedAt: "", result: "pass", certificateUrl: "" });

  if (isLoading || !equipment) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
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
        <h2 className="mb-3 text-sm font-medium">Calibration History</h2>
        <ul className="mb-4 flex flex-col gap-2 text-sm">
          {calibrations.length === 0 && <li className="text-muted-foreground">No calibration events logged yet.</li>}
          {calibrations.map((c) => (
            <li key={c.id} className="flex items-center justify-between border-b border-border pb-2">
              <span>{new Date(c.performedAt).toLocaleDateString()}</span>
              <span className="capitalize">{c.result ?? "—"}</span>
              <span className="text-muted-foreground">Next due: {c.nextDueAt ? new Date(c.nextDueAt).toLocaleDateString() : "—"}</span>
            </li>
          ))}
        </ul>

        <form
          className="grid gap-3 md:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await apiClient.post(`/equipment/${equipmentId}/calibration`, entry);
            setEntry({ performedAt: "", result: "pass", certificateUrl: "" });
            queryClient.invalidateQueries({ queryKey: ["equipment", equipmentId, "calibration"] });
          }}
        >
          <TextField label="Performed At" type="date" value={entry.performedAt} onChange={(e) => setEntry({ ...entry, performedAt: e.target.value })} required />
          <SelectField label="Result" value={entry.result} onChange={(e) => setEntry({ ...entry, result: e.target.value })}>
            {["pass", "fail", "adjusted"].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </SelectField>
          <TextField label="Certificate URL" value={entry.certificateUrl} onChange={(e) => setEntry({ ...entry, certificateUrl: e.target.value })} />
          <button type="submit" className="w-fit self-end rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            Log calibration
          </button>
        </form>
      </div>
    </div>
  );
}

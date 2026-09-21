import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { AttentionStrip, EquipmentStatusBadge, type EquipmentState } from "../../components/calibration/EquipmentPanels";

interface Equipment extends EquipmentState {
  serialNumber: string | null;
  location: string | null;
  type: string | null;
  calibrationIntervalDays: number;
}

/**
 * Equipment register. Every row carries the state the server works out (calibration.service.ts): out of service / inactive,
 * or how it stands against its due date (past due, within 30 or 60 days, current, never calibrated, failed), and any calibration
 * that is scheduled. The strip on top lists what needs attention right now and can email it to Quality.
 */
export function CalibrationPage() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4">
      <AttentionStrip />
      <ResourceListPage<Equipment>
        title="Calibration"
        resource="equipment"
        onRowClick={(e) => navigate(`/calibration/${e.id}`)}
        onCreated={(e) => navigate(`/calibration/${e.id}`)}
        columns={[
          { header: "ID", accessor: (e) => `#${e.id}` },
          { header: "Equipment", accessor: (e) => e.name },
          { header: "Type", accessor: (e) => e.type ?? "—" },
          { header: "Serial #", accessor: (e) => e.serialNumber ?? "—" },
          { header: "Location", accessor: (e) => e.location ?? "—" },
          { header: "Interval (days)", accessor: (e) => e.calibrationIntervalDays },
          { header: "Next Due", accessor: (e) => (e.nextDueAt ? new Date(e.nextDueAt).toLocaleDateString() : "—") },
          { header: "Scheduled", accessor: (e) => (e.nextScheduledAt ? `${new Date(e.nextScheduledAt).toLocaleDateString()}${e.scheduleOverdue ? " (late)" : ""}` : "—") },
          // Out of service / inactive outrank the due date; otherwise coloured by the server's due status (60 / 30 day bands, past due, failed).
          { header: "Status", accessor: (e) => <EquipmentStatusBadge status={e.status} dueStatus={e.dueStatus} /> },
        ]}
        createFields={[
          { name: "name", label: "Equipment name" },
          { name: "type", label: "Type (caliper, torque wrench, scale…)" },
          { name: "serialNumber", label: "Serial number" },
          { name: "location", label: "Location" },
          { name: "calibrationIntervalDays", label: "Calibration interval (days)", type: "number" },
        ]}
      />
    </div>
  );
}

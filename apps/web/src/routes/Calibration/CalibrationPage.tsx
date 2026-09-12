import { useNavigate } from "react-router-dom";
import { ResourceListPage } from "../../components/layout/ResourceListPage";
import { STATUS_COLORS, calibrationStatusFromDueDate } from "../../components/forms/formulas";

interface Equipment {
  id: number;
  name: string;
  serialNumber: string | null;
  location: string | null;
  calibrationIntervalDays: number;
  /** Resolved server-side (calibration.controller.ts's listWithStatus) from that equipment's most recent calibration record. */
  nextDueAt: string | null;
}

/** Colored pill for a computed calibration status — same look as a form's ComputedCell, for the same reason: state should read at a glance, not just as a date. */
function CalibrationStatusBadge({ nextDueAt }: { nextDueAt: string | null }) {
  const label = calibrationStatusFromDueDate(nextDueAt);
  const colors = STATUS_COLORS[label] ?? { bg: "#EAEAE6", fg: "#66655D" };
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: colors.bg, color: colors.fg }}
    >
      {label}
    </span>
  );
}

export function CalibrationPage() {
  const navigate = useNavigate();
  return (
    <ResourceListPage<Equipment>
      title="Calibration"
      resource="equipment"
      onRowClick={(e) => navigate(`/calibration/${e.id}`)}
      onCreated={(e) => navigate(`/calibration/${e.id}`)}
      columns={[
        { header: "ID", accessor: (e) => `#${e.id}` },
        { header: "Equipment", accessor: (e) => e.name },
        { header: "Serial #", accessor: (e) => e.serialNumber ?? "—" },
        { header: "Location", accessor: (e) => e.location ?? "—" },
        { header: "Interval (days)", accessor: (e) => e.calibrationIntervalDays },
        { header: "Next Due", accessor: (e) => (e.nextDueAt ? new Date(e.nextDueAt).toLocaleDateString() : "—") },
        // Automatically color-coded: green when due date is more than 60 days out, amber within
        // 60 days, orange within 30 days, red once past due — recomputed every render, not stored.
        { header: "Status", accessor: (e) => <CalibrationStatusBadge nextDueAt={e.nextDueAt} /> },
      ]}
      createFields={[
        { name: "name", label: "Equipment name" },
        { name: "serialNumber", label: "Serial number" },
        { name: "location", label: "Location" },
        { name: "calibrationIntervalDays", label: "Calibration interval (days)", type: "number" },
      ]}
    />
  );
}

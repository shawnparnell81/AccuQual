import type { CellValue } from "./isoFormLogic";

export const MONTHLY_TITLE = "MONTHLY ENGINEERING DEVELOPMENT REPORT";

export const KPI_CATEGORIES = [
  "CSA",
  "Shocks/Struts",
  "HD Shocks",
  "Coil Springs",
  "Air Struts & Shocks",
  "Air Compressors",
  "Ride Height Sensors",
  "Fuel Pumps",
  "GDI Pumps",
  "Fuel Injectors",
  "Lift Supports",
  "Electric Lift Supports",
  "Brake Wear Sensors",
] as const;

export const DETAIL_SECTIONS: Array<{ title: string; fields: Array<{ key: string; label: string }> }> = [
  { title: "5.1 Complete Strut Assemblies", fields: [{ key: "d1s", label: "Suppliers" }, { key: "d1a", label: "Monthly Fully Approved" }, { key: "d1c", label: "Consolidated" }, { key: "d1o", label: "Optimizations" }, { key: "d1f", label: "Non-Conforming / Failed" }, { key: "d1p", label: "Pending (Missing Info)" }] },
  { title: "5.2 Shocks & Struts", fields: [{ key: "d2s", label: "Suppliers" }, { key: "d2f", label: "Project Focus" }, { key: "d2a", label: "Monthly Fully Approved" }, { key: "d2d", label: "Monthly Drawings Approved" }, { key: "d2m", label: "Sample Status" }, { key: "d2n", label: "Deviation Note" }] },
  { title: "5.3 HD Shocks", fields: [{ key: "d3s", label: "Suppliers" }, { key: "d3f", label: "Project Focus" }, { key: "d3a", label: "Monthly Fully Approved" }, { key: "d3d", label: "Monthly Drawings Approved" }, { key: "d3m", label: "Sample Status" }, { key: "d3n", label: "Deviation Note" }] },
  { title: "5.4 Coil Springs", fields: [{ key: "d4s", label: "Suppliers" }, { key: "d4f", label: "Project Focus" }, { key: "d4a", label: "Monthly Fully Approved" }, { key: "d4d", label: "Monthly Drawings Approved" }, { key: "d4c", label: "3D Scanned (Internal)" }, { key: "d4p", label: "Data Sent to APM" }] },
  { title: "5.5 Air Struts & Shocks", fields: [{ key: "d5s", label: "Suppliers" }, { key: "d5f", label: "Project Focus" }, { key: "d5a", label: "Monthly Fully Approved" }, { key: "d5d", label: "Monthly Drawings Approved" }, { key: "d5m", label: "Sample Status" }, { key: "d5n", label: "Deviation Note" }] },
  { title: "5.6 Air Compressors", fields: [{ key: "d6s", label: "Suppliers" }, { key: "d6f", label: "Project Focus" }, { key: "d6a", label: "Monthly Fully Approved" }, { key: "d6d", label: "Monthly Drawings Approved" }, { key: "d6m", label: "Sample Status" }, { key: "d6n", label: "Deviation Note" }] },
  { title: "5.7 Ride Height Sensors", fields: [{ key: "d7s", label: "Suppliers" }, { key: "d7f", label: "Project Focus" }, { key: "d7a", label: "Monthly Fully Approved" }, { key: "d7d", label: "Monthly Drawings Approved" }, { key: "d7m", label: "Sample Status" }, { key: "d7n", label: "Deviation Note" }] },
  { title: "5.8 Fuel Pumps", fields: [{ key: "d8s", label: "Suppliers" }, { key: "d8f", label: "Project Focus" }, { key: "d8a", label: "Monthly Fully Approved" }, { key: "d8d", label: "Monthly Drawings Approved" }, { key: "d8m", label: "Sample Status" }, { key: "d8n", label: "Deviation Note" }] },
  { title: "5.9 GDI Pumps", fields: [{ key: "d9s", label: "Suppliers" }, { key: "d9f", label: "Project Focus" }, { key: "d9a", label: "Monthly Fully Approved" }, { key: "d9d", label: "Monthly Drawings Approved" }, { key: "d9m", label: "Sample Status" }, { key: "d9n", label: "Deviation Note" }] },
  { title: "5.10 Fuel Injectors", fields: [{ key: "das", label: "Suppliers" }, { key: "daf", label: "Project Focus" }, { key: "daa", label: "Monthly Fully Approved" }, { key: "dad", label: "Monthly Drawings Approved" }, { key: "dam", label: "Sample Status" }, { key: "dan", label: "Deviation Note" }] },
  { title: "5.11 Lift Supports", fields: [{ key: "dbs", label: "Suppliers" }, { key: "dbf", label: "Project Focus" }, { key: "dba", label: "Monthly Fully Approved" }, { key: "dbd", label: "Monthly Drawings Approved" }, { key: "dbm", label: "Sample Status" }, { key: "dbn", label: "Deviation Note" }] },
  { title: "5.12 Electric Lift Supports", fields: [{ key: "dcs", label: "Suppliers" }, { key: "dcf", label: "Project Focus" }, { key: "dca", label: "Monthly Fully Approved" }, { key: "dcd", label: "Monthly Drawings Approved" }, { key: "dcm", label: "Sample Status" }, { key: "dcn", label: "Deviation Note" }] },
  { title: "5.13 Brake Wear Sensors", fields: [{ key: "dds", label: "Suppliers" }, { key: "ddf", label: "Project Focus" }, { key: "dda", label: "Monthly Fully Approved" }, { key: "ddd", label: "Monthly Drawings Approved" }, { key: "ddm", label: "Sample Status" }, { key: "ddn", label: "Deviation Note" }] },
];

export function monthlyStarter(): Record<string, string> {
  return { dept: "Product Engineering", prep: "Shawn Parnell" };
}

function numberOf(value: CellValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Total yearly approved is full development plus drawings. Percent of goal is that total over the yearly target. */
export function kpiScore(cells: Record<string, CellValue>, index: number): { total: string; percent: string } {
  const full = numberOf(cells[`k${index}f`]);
  const drawings = numberOf(cells[`k${index}d`]);
  const target = numberOf(cells[`k${index}t`]);
  if (full == null && drawings == null) return { total: "", percent: target == null ? "" : "#DIV/0!" };
  const total = (full ?? 0) + (drawings ?? 0);
  if (target == null || target === 0) return { total: String(total), percent: "#DIV/0!" };
  const percent = Math.round((total / target) * 10000) / 100;
  return { total: String(total), percent: `${percent}%` };
}

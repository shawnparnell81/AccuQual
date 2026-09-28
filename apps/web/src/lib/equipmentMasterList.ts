/** Live Master Equipment List (LST-EQP-001). Dates and colors are worked out from the equipment record. Nothing is copied into a second list. */

export const EQUIPMENT_LIST_ID = "LST-EQP-001";
export const EQUIPMENT_STATUSES = ["Active", "Out of Service", "Scrapped", "CNR"] as const;
export type EquipmentListStatus = (typeof EQUIPMENT_STATUSES)[number];

export interface EquipmentSource {
  id: number;
  name: string;
  serialNumber: string | null;
  location: string | null;
  status: "active" | "inactive" | "out_of_service";
  calibrationIntervalDays: number;
  metadata?: Record<string, unknown> | null;
  lastCalibratedAt?: string | null;
}

export interface EquipmentListRow {
  id: number;
  assetId: string;
  name: string;
  manufacturer: string;
  serial: string;
  location: string;
  method: string;
  intervalMonths: number;
  lastCal: string;
  nextDue: string | null;
  status: EquipmentListStatus;
  tone: "red" | "yellow" | "green" | "none";
}

const DAY_MS = 86_400_000;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function monthsFromDays(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 12;
  return Math.max(1, Math.round((days * 12) / 365));
}

export function intervalMonthsOf(item: EquipmentSource): number {
  const stored = item.metadata?.calIntervalMonths;
  if (typeof stored === "number" && stored > 0) return Math.round(stored);
  return monthsFromDays(item.calibrationIntervalDays);
}

export function listStatusOf(item: EquipmentSource): EquipmentListStatus {
  const stored = text(item.metadata?.listStatus);
  if (stored === "Active" || stored === "Out of Service" || stored === "Scrapped" || stored === "CNR") return stored;
  if (item.status === "out_of_service") return "Out of Service";
  if (item.status === "inactive") return "Scrapped";
  return "Active";
}

/** Last Cal + interval months. Day-of-month clamps to the end of the target month. */
export function addMonths(isoDate: string, months: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1) return null;
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  const result = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), clamped));
  return result.toISOString().slice(0, 10);
}

export function dueTone(nextDue: string | null, status: EquipmentListStatus, today = new Date()): EquipmentListRow["tone"] {
  if (!nextDue || status === "CNR" || status === "Scrapped") return "none";
  const due = Date.parse(`${nextDue}T00:00:00Z`);
  if (Number.isNaN(due)) return "none";
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((due - start) / DAY_MS);
  if (days < 0) return "red";
  if (days <= 60) return "yellow";
  return "green";
}

export function equipmentListRow(item: EquipmentSource, today = new Date()): EquipmentListRow {
  const status = listStatusOf(item);
  const intervalMonths = intervalMonthsOf(item);
  const lastCal = item.lastCalibratedAt ? item.lastCalibratedAt.slice(0, 10) : "";
  const nextDue = lastCal && status !== "CNR" ? addMonths(lastCal, intervalMonths) : null;
  return {
    id: item.id,
    assetId: text(item.metadata?.assetId) || String(item.id),
    name: item.name,
    manufacturer: text(item.metadata?.manufacturer),
    serial: item.serialNumber ?? "",
    location: item.location ?? "",
    method: text(item.metadata?.method),
    intervalMonths,
    lastCal,
    nextDue,
    status,
    tone: dueTone(nextDue, status, today),
  };
}

export function daysForMonths(months: number): number {
  return Math.max(1, Math.round((months * 365) / 12));
}

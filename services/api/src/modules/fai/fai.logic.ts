/**
 * First-article math and source-approval rules.
 * Pure functions: the screen, the API, and the PDF all call these.
 * Percent-from-nominal lives here. The existing nominal/tolerance check
 * on current sheets is unchanged.
 */
import { parseMeasure } from "../../utils/passFail.js";
import { isReviewerRole } from "../roles/roleAccess.js";

export const DEFAULT_CADENCE_MONTHS = 6;
export const DUE_SOON_DAYS = 30;

export const CHARACTERISTIC_MODES = ["percent_nominal", "plus_minus", "min_max", "attribute"] as const;
export type CharacteristicMode = (typeof CHARACTERISTIC_MODES)[number];

export type FaiStatus = "open" | "submitted" | "approved" | "rejected";
export type SourceStatus = "pending" | "approved" | "failed";
export type PassFailWord = "Pass" | "Fail" | "";

export interface CharacteristicInput {
  balloon?: string | null;
  name: string;
  mode: CharacteristicMode;
  nominal?: string | null;
  percent?: string | null;
  plusTolerance?: string | null;
  minusTolerance?: string | null;
  specMin?: string | null;
  specMax?: string | null;
}

export interface FrozenCharacteristic {
  balloon: string;
  name: string;
  mode: CharacteristicMode;
  nominal: string | null;
  percent: string | null;
  plusTolerance: string | null;
  minusTolerance: string | null;
  specMin: string | null;
  specMax: string | null;
  limitLow: string | null;
  limitHigh: string | null;
}

export interface PlanStructure {
  scope: "part" | "family";
  partNumber: string | null;
  productFamily: string | null;
  supplierId: number | null;
  cadenceMonths: number;
  characteristics: CharacteristicInput[];
}

export interface SourceSnapshot {
  status: SourceStatus;
  lastPassDate: string | null;
  nextDueDate: string | null;
  cadenceMonths: number;
}

const EPS = 1e-9;

export function isCharacteristicMode(value: string): value is CharacteristicMode {
  return (CHARACTERISTIC_MODES as readonly string[]).includes(value);
}

export function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** A plan may set its own interval. Anything else uses six months. */
export function normalizeCadence(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60) return DEFAULT_CADENCE_MONTHS;
  return parsed;
}

export function formatFaiNumber(year: number, sequence: number): string {
  return `FAI-${year}-${String(sequence).padStart(6, "0")}`;
}

export function formatLimit(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 1e6) / 1e6;
  return String(rounded);
}

function band(low: number, high: number): { low: number; high: number } {
  return low <= high ? { low, high } : { low: high, high: low };
}

export function characteristicError(input: CharacteristicInput): string | null {
  const name = cleanText(input.name);
  if (!name) return "Each characteristic needs a name.";
  if (!isCharacteristicMode(input.mode)) return `${name} needs a limit mode.`;
  if (input.mode === "attribute") return null;

  if (input.mode === "percent_nominal") {
    const nominal = parseMeasure(cleanText(input.nominal));
    const percent = parseMeasure(cleanText(input.percent));
    if (nominal == null) return `${name} needs a nominal value.`;
    if (percent == null || percent < 0) return `${name} needs a percent from nominal.`;
    return null;
  }

  if (input.mode === "plus_minus") {
    const nominal = parseMeasure(cleanText(input.nominal));
    const plus = parseMeasure(cleanText(input.plusTolerance));
    const minus = parseMeasure(cleanText(input.minusTolerance));
    if (nominal == null) return `${name} needs a nominal value.`;
    if ((plus == null || plus < 0) && (minus == null || minus < 0)) return `${name} needs a plus or minus tolerance.`;
    if (plus != null && plus < 0) return `${name} plus tolerance cannot be negative.`;
    if (minus != null && minus < 0) return `${name} minus tolerance cannot be negative.`;
    return null;
  }

  const low = parseMeasure(cleanText(input.specMin));
  const high = parseMeasure(cleanText(input.specMax));
  if (low == null && high == null) return `${name} needs a minimum or a maximum.`;
  if (low != null && high != null && low > high) return `${name} minimum is above the maximum.`;
  return null;
}

/**
 * Copies one characteristic onto an FAI line and freezes the limits.
 * Later edits to the plan do not change the returned object.
 */
export function freezeCharacteristic(input: CharacteristicInput): FrozenCharacteristic {
  const error = characteristicError(input);
  if (error) throw new Error(error);
  const name = cleanText(input.name) ?? "";
  const balloon = cleanText(input.balloon) ?? "";
  const nominal = cleanText(input.nominal);
  const percent = cleanText(input.percent);
  const plusRaw = cleanText(input.plusTolerance);
  const minusRaw = cleanText(input.minusTolerance);
  const specMin = cleanText(input.specMin);
  const specMax = cleanText(input.specMax);

  if (input.mode === "attribute") {
    return {
      balloon,
      name,
      mode: "attribute",
      nominal: null,
      percent: null,
      plusTolerance: null,
      minusTolerance: null,
      specMin: null,
      specMax: null,
      limitLow: null,
      limitHigh: null,
    };
  }

  if (input.mode === "percent_nominal") {
    const nominalValue = parseMeasure(nominal)!;
    const percentValue = parseMeasure(percent)!;
    const span = band(nominalValue * (1 - percentValue / 100), nominalValue * (1 + percentValue / 100));
    return {
      balloon,
      name,
      mode: "percent_nominal",
      nominal,
      percent,
      plusTolerance: null,
      minusTolerance: null,
      specMin: null,
      specMax: null,
      limitLow: formatLimit(span.low),
      limitHigh: formatLimit(span.high),
    };
  }

  if (input.mode === "plus_minus") {
    const nominalValue = parseMeasure(nominal)!;
    const plus = parseMeasure(plusRaw);
    const minus = parseMeasure(minusRaw);
    const plusSpan = plus ?? minus ?? 0;
    const minusSpan = minus ?? plus ?? 0;
    const span = band(nominalValue - minusSpan, nominalValue + plusSpan);
    return {
      balloon,
      name,
      mode: "plus_minus",
      nominal,
      percent: null,
      plusTolerance: formatLimit(plusSpan),
      minusTolerance: formatLimit(minusSpan),
      specMin: null,
      specMax: null,
      limitLow: formatLimit(span.low),
      limitHigh: formatLimit(span.high),
    };
  }

  const low = parseMeasure(specMin);
  const high = parseMeasure(specMax);
  return {
    balloon,
    name,
    mode: "min_max",
    nominal,
    percent: null,
    plusTolerance: null,
    minusTolerance: null,
    specMin: low == null ? null : formatLimit(low),
    specMax: high == null ? null : formatLimit(high),
    limitLow: low == null ? null : formatLimit(low),
    limitHigh: high == null ? null : formatLimit(high),
  };
}

export function limitsLabel(line: Pick<FrozenCharacteristic, "mode" | "nominal" | "percent" | "plusTolerance" | "minusTolerance" | "limitLow" | "limitHigh">): string {
  if (line.mode === "attribute") return "Pass / Fail";
  if (line.mode === "percent_nominal") return `${line.nominal} ± ${line.percent}% (${line.limitLow} – ${line.limitHigh})`;
  if (line.mode === "plus_minus") return `${line.nominal} +${line.plusTolerance}/-${line.minusTolerance} (${line.limitLow} – ${line.limitHigh})`;
  if (line.limitLow && line.limitHigh) return `${line.limitLow} – ${line.limitHigh}`;
  if (line.limitLow) return `≥ ${line.limitLow}`;
  if (line.limitHigh) return `≤ ${line.limitHigh}`;
  return "";
}

function inFrozenBand(actual: number, low: number | null, high: number | null): boolean {
  if (low != null && actual < low - EPS) return false;
  if (high != null && actual > high + EPS) return false;
  return low != null || high != null;
}

/** Pass or fail from the limits copied onto the line. Blank until it can be decided. */
export function judgeFrozen(
  line: Pick<FrozenCharacteristic, "mode" | "limitLow" | "limitHigh">,
  actualRaw: string | number | null | undefined,
  attributeResult?: string | null,
): PassFailWord {
  if (line.mode === "attribute") {
    const word = cleanText(attributeResult);
    if (word === "Pass" || word === "Fail") return word;
    return "";
  }
  const actual = parseMeasure(actualRaw);
  if (actual == null) return "";
  const low = parseMeasure(line.limitLow);
  const high = parseMeasure(line.limitHigh);
  if (low == null && high == null) return "";
  return inFrozenBand(actual, low, high) ? "Pass" : "Fail";
}

export function readyToSubmit(results: PassFailWord[]): boolean {
  return results.length > 0 && results.every((result) => result === "Pass" || result === "Fail");
}

function normalizedCharacteristic(input: CharacteristicInput) {
  return {
    balloon: cleanText(input.balloon) ?? "",
    name: cleanText(input.name) ?? "",
    mode: input.mode,
    nominal: cleanText(input.nominal),
    percent: cleanText(input.percent),
    plusTolerance: cleanText(input.plusTolerance),
    minusTolerance: cleanText(input.minusTolerance),
    specMin: cleanText(input.specMin),
    specMax: cleanText(input.specMax),
  };
}

export function structureKey(plan: PlanStructure): string {
  return JSON.stringify({
    scope: plan.scope,
    partNumber: cleanText(plan.partNumber) ?? "",
    productFamily: cleanText(plan.productFamily) ?? "",
    supplierId: plan.supplierId ?? null,
    cadenceMonths: normalizeCadence(plan.cadenceMonths),
    characteristics: plan.characteristics.map(normalizedCharacteristic),
  });
}

export function samePlanStructure(left: PlanStructure, right: PlanStructure): boolean {
  return structureKey(left) === structureKey(right);
}

/** A real change to the plan is the next revision. An unchanged plan, and filling an FAI, stay on the current revision. */
export function revisionForPlanSave(current: number | null, previous: PlanStructure | null, next: PlanStructure): number {
  if (current == null || previous == null) return 1;
  if (samePlanStructure(previous, next)) return current;
  return current + 1;
}

export function addCalendarMonths(isoDate: string, months: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !Number.isInteger(months)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  return result.toISOString().slice(0, 10);
}

export function formalDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, (month ?? 1) - 1, day));
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(date);
}

export function daysUntil(due: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const dueMs = Date.parse(`${due}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(dueMs) || Number.isNaN(todayMs)) return null;
  return Math.round((dueMs - todayMs) / 86_400_000);
}

export function newSourceRow(cadenceMonths: number): SourceSnapshot {
  return { status: "pending", lastPassDate: null, nextDueDate: null, cadenceMonths: normalizeCadence(cadenceMonths) };
}

/** Approval records the pass date and the next due date from the plan cadence. */
export function approveSource(source: SourceSnapshot, passDate: string, cadenceMonths: number): SourceSnapshot {
  const cadence = normalizeCadence(cadenceMonths);
  const nextDueDate = addCalendarMonths(passDate, cadence);
  if (!nextDueDate) throw new Error("The pass date is not a calendar date.");
  return { status: "approved", lastPassDate: passDate, nextDueDate, cadenceMonths: cadence };
}

/** Rejection marks the source failed. The last pass date stays the last time it actually passed. */
export function rejectSource(source: SourceSnapshot): SourceSnapshot {
  return { ...source, status: "failed" };
}

export type SourceQueueBucket = "due_soon" | "overdue" | "failed";

export function sourceQueueBucket(source: Pick<SourceSnapshot, "status" | "nextDueDate">, today: string): SourceQueueBucket | null {
  if (source.status === "failed") return "failed";
  if (source.status !== "approved" || !source.nextDueDate) return null;
  const days = daysUntil(source.nextDueDate, today);
  if (days == null) return null;
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due_soon";
  return null;
}

/** A completed pull covers the part until the same calendar day twelve months later. */
export function needsAnnualPull(lastCompletedOn: string | null, today: string): boolean {
  if (!lastCompletedOn) return true;
  const coveredUntil = addCalendarMonths(lastCompletedOn, 12);
  if (!coveredUntil) return true;
  return coveredUntil <= today;
}

export interface FaiActor {
  id?: number | null;
  roleName?: string | null;
  department?: string | null;
}

/** Quality, and the roles that already approve quality work, may approve or reject. */
export function canApproveFai(actor: FaiActor): boolean {
  if (isReviewerRole(actor.roleName)) return true;
  return actor.department === "quality";
}

export function canRecordAnnualPull(actor: FaiActor, assignedTo: number | null): boolean {
  if (canApproveFai(actor)) return true;
  return actor.id != null && actor.id === assignedTo;
}

function faiLabel(number: string | null | undefined): string {
  const shown = number?.trim() ?? "";
  return shown || "This first article";
}

export function noticeAssigned(number: string | null, name: string): string {
  return `${faiLabel(number)} is ready for result entry. It is assigned to ${name}.`;
}

export function noticeSubmitted(number: string | null): string {
  return `${faiLabel(number)} has been submitted for Quality review.`;
}

export function noticeApproved(number: string | null, part: string, supplier: string, due: string): string {
  return `${faiLabel(number)} was approved. ${part} from ${supplier} is approved. The next inspection is due ${due}.`;
}

export function noticeRejected(number: string | null, part: string, supplier: string): string {
  return `${faiLabel(number)} was not approved. A nonconformance was opened. ${part} from ${supplier} is not approved.`;
}

export function noticeDueSoon(part: string, supplier: string, due: string): string {
  return `Inspection for ${part} from ${supplier} is due on ${due}.`;
}

export function noticeOverdue(part: string, supplier: string): string {
  return `Inspection for ${part} from ${supplier} is overdue.`;
}

export function noticePullAssigned(name: string, part: string): string {
  return `${name} has been assigned the annual pull for ${part}.`;
}

export function noticePullRecorded(part: string): string {
  return `The annual pull for ${part} has been recorded.`;
}

export function auditEntry(who: string, what: string, when: Date, description: string): Record<string, unknown> {
  return { who, what, when: when.toISOString(), description };
}

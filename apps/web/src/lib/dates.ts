/**
 * Shared date formatting.
 *
 * A date-only value is a calendar day (`YYYY-MM-DD`, or midnight/noon UTC
 * standing in for that day). `new Date("2026-10-08")` is UTC midnight, and
 * `toLocaleDateString()` in America/New_York then prints the previous day.
 * Those values are formatted on the UTC calendar. A real timestamp still
 * uses the viewer's local clock.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

export function calendarDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (DATE_ONLY.test(text)) return text;
    const prefixed = DATE_PREFIX.exec(text);
    if (prefixed && /T(?:00|12):00:00(?:\.0+)?(?:Z|[+-]00:?00)?$/.test(text)) return prefixed[1]!;
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const iso = date.toISOString();
  if (iso.endsWith("T00:00:00.000Z") || iso.endsWith("T12:00:00.000Z")) return iso.slice(0, 10);
  return "";
}

/** Value for `<input type="date">`. The leading calendar day is kept as typed. */
export function dateInputValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") {
    const match = DATE_PREFIX.exec(value.trim());
    if (match) return match[1]!;
  }
  return calendarDate(value as string | number | Date);
}

export function formatDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const ymd = calendarDate(value);
  if (ymd) {
    const [year, month, day] = ymd.split("-").map(Number);
    return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (calendarDate(value)) return formatDate(value);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

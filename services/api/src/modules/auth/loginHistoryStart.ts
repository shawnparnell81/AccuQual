const EASTERN = "America/New_York";

/** 2026-10-12 12:00 AM Eastern. Used when the company has not stored a start. */
export const LOGIN_HISTORY_START_ISO = "2026-10-12T04:00:00.000Z";

export function loginHistoryStartsAt(profile: { loginHistoryStartsAt?: string | null } | null | undefined): Date {
  const raw = profile?.loginHistoryStartsAt?.trim();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(LOGIN_HISTORY_START_ISO);
}

export function recordingOpen(startsAt: Date, now = new Date()): boolean {
  return now.getTime() >= startsAt.getTime();
}

function zonedParts(instant: Date, timeZone: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? "";
}

/** Minutes east of UTC for America/New_York at this instant. Eastern Daylight is -240. */
export function easternOffsetMinutes(instant: Date): number {
  const utc = zonedParts(instant, "UTC");
  const eastern = zonedParts(instant, EASTERN);
  const utcMillis = Date.UTC(Number(part(utc, "year")), Number(part(utc, "month")) - 1, Number(part(utc, "day")), Number(part(utc, "hour")), Number(part(utc, "minute")));
  const easternMillis = Date.UTC(Number(part(eastern, "year")), Number(part(eastern, "month")) - 1, Number(part(eastern, "day")), Number(part(eastern, "hour")), Number(part(eastern, "minute")));
  return Math.round((easternMillis - utcMillis) / 60_000);
}

/** `YYYY-MM-DDTHH:mm` with no zone is an Eastern Time wall clock. A zoned instant is used as-is. */
export function parseRecordingStart(value: string): Date | null {
  const trimmed = value.trim();
  const wall = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed);
  if (wall) {
    const year = Number(wall[1]);
    const month = Number(wall[2]);
    const day = Number(wall[3]);
    const hour = Number(wall[4]);
    const minute = Number(wall[5]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    const first = wallAsUtc - easternOffsetMinutes(new Date(wallAsUtc)) * 60_000;
    return new Date(wallAsUtc - easternOffsetMinutes(new Date(first)) * 60_000);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function utcToEasternWall(instant: Date): string {
  const parts = zonedParts(instant, EASTERN);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}T${part(parts, "hour")}:${part(parts, "minute")}`;
}

/** "Recording starts Oct 12, 2026 12:00 AM ET" */
export function recordingStartNotice(startsAt: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(startsAt);
  const minute = part(parts, "minute").padStart(2, "0");
  return `Recording starts ${part(parts, "month")} ${part(parts, "day")}, ${part(parts, "year")} ${part(parts, "hour")}:${minute} ${part(parts, "dayPeriod")} ET`;
}

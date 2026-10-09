/** How long a sign-in lasts when the company has not chosen a length. Activity does not extend it. */
export const DEFAULT_SESSION_LENGTH_HOURS = 12;
export const MIN_SESSION_LENGTH_HOURS = 1;
export const MAX_SESSION_LENGTH_HOURS = 24;

export function sessionLengthHoursFromProfile(profile: { sessionLengthHours?: unknown } | null | undefined): number {
  const value = profile?.sessionLengthHours;
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_SESSION_LENGTH_HOURS;
  if (value < MIN_SESSION_LENGTH_HOURS || value > MAX_SESSION_LENGTH_HOURS) return DEFAULT_SESSION_LENGTH_HOURS;
  return value;
}

export function sessionLengthMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

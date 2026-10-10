/** "Updated 7:04 PM ET" from a clock instant. */
export function formatUpdatedEt(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `Updated ${part("hour")}:${part("minute")} ${part("dayPeriod").toUpperCase()} ET`;
}

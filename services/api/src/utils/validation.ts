import { z } from "zod";

/**
 * Real, live-reproduced bug this guards against: `z.coerce.date()` alone
 * only checks that `new Date(input)` isn't NaN — JS's lenient date parser
 * happily accepts a mistyped string like "91920-02-06" as a real (if
 * absurd) Date object with year 91920, so that check passes. It then
 * crashes with an unhandled 500 at the Postgres layer ("time zone
 * displacement out of range") instead of failing validation cleanly — the
 * error never reaches this schema's job of catching it. A generous but
 * real bound (1900–2200) turns that into an honest 400. Use this in place
 * of a bare `z.coerce.date()` anywhere a date comes from client input.
 */
/**
 * `YYYY-MM-DD` is a calendar day. `new Date("2026-10-08")` is UTC midnight,
 * which America/New_York prints as the day before. Store that day at UTC noon
 * so every US plant shows the same date.
 */
function calendarDay(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
}

export const reasonableDate = z.preprocess(
  calendarDay,
  z.coerce.date().refine((d) => d.getUTCFullYear() >= 1900 && d.getUTCFullYear() <= 2200, "Not a valid date"),
);

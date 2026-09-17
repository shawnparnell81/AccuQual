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
export const reasonableDate = z.coerce.date().refine((d) => d.getFullYear() >= 1900 && d.getFullYear() <= 2200, "Not a valid date");

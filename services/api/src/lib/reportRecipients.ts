import { z } from "zod";

/** One saved report or schedule can name this many inboxes. */
export const MAX_REPORT_RECIPIENTS = 40;

const parsedEmail = z.string().email();

export function isReportEmail(value: string): boolean {
  return parsedEmail.safeParse(value).success;
}

export type RecipientResult = { ok: true; emails: string[] } | { ok: false; error: string };

/** Trim, lowercase, drop blanks, reject a bad address, and drop duplicates. */
export function normalizeReportRecipients(input: unknown): RecipientResult {
  if (!Array.isArray(input)) return { ok: false, error: "Recipients must be a list of email addresses." };
  const emails: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") return { ok: false, error: "Each recipient must be an email address." };
    const value = raw.trim().toLowerCase();
    if (!value) continue;
    if (!isReportEmail(value)) return { ok: false, error: `"${raw.trim()}" is not a valid email address.` };
    if (seen.has(value)) continue;
    seen.add(value);
    emails.push(value);
    if (emails.length > MAX_REPORT_RECIPIENTS) {
      return { ok: false, error: `A report can have at most ${MAX_REPORT_RECIPIENTS} recipients.` };
    }
  }
  return { ok: true, emails };
}

/** Add one typed address to a list that is already stored. */
export function addRecipient(current: string[], raw: string): RecipientResult {
  const existing = normalizeReportRecipients(current);
  if (!existing.ok) return existing;
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Type an email address." };
  const value = trimmed.toLowerCase();
  if (!isReportEmail(value)) return { ok: false, error: `"${trimmed}" is not a valid email address.` };
  if (existing.emails.includes(value)) return { ok: false, error: "That address is already on the list." };
  if (existing.emails.length >= MAX_REPORT_RECIPIENTS) {
    return { ok: false, error: `A report can have at most ${MAX_REPORT_RECIPIENTS} recipients.` };
  }
  return { ok: true, emails: [...existing.emails, value] };
}

/** Keep valid stored addresses and skip junk left from an older row. */
export function readStoredRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const emails: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const next = raw.trim().toLowerCase();
    if (!next || !isReportEmail(next) || seen.has(next)) continue;
    seen.add(next);
    emails.push(next);
    if (emails.length >= MAX_REPORT_RECIPIENTS) break;
  }
  return emails;
}

export function recipientLabel(email: string, people: { name: string; email: string }[]): string {
  const key = email.trim().toLowerCase();
  const match = people.find((person) => person.email.trim().toLowerCase() === key);
  const name = match?.name.trim() ?? "";
  if (name && name.toLowerCase() !== key) return name;
  return key;
}

/** Zod field: `min` 1 for a send or a schedule, 0 when a saved report may have nobody yet. */
export function zodRecipients(min: number) {
  return z
    .array(z.string().max(320))
    .max(80)
    .superRefine((items, ctx) => {
      const result = normalizeReportRecipients(items);
      if (!result.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
        return;
      }
      if (result.emails.length < min) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Add at least one email address." });
      }
    })
    .transform((items) => {
      const result = normalizeReportRecipients(items);
      return result.ok ? result.emails : [];
    });
}

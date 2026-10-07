/** Same rules as services/api/src/lib/reportRecipients.ts. The server rejects a list this accepts by mistake. */

export const MAX_REPORT_RECIPIENTS = 40;

// Zod 3's email check, so the chip field and the API agree.
const EMAIL = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+.-]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;

export function isReportEmail(value: string): boolean {
  return EMAIL.test(value);
}

export type RecipientResult = { ok: true; emails: string[] } | { ok: false; error: string };

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

export function recipientLabel(email: string, people: { name: string; email: string }[]): string {
  const key = email.trim().toLowerCase();
  const match = people.find((person) => person.email.trim().toLowerCase() === key);
  const name = match?.name.trim() ?? "";
  if (name && name.toLowerCase() !== key) return name;
  return key;
}

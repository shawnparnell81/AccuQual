import { and, eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { notifyInApp } from "../notifications/notification.service.js";
import { roleTitleMatches } from "../workflow/assignees.js";
import type { SlaNotice } from "./ncrSla.js";

const OWNER_FIELDS: Record<string, string[]> = {
  "action owner": ["action_owner", "actionOwner", "corrective_action_owner"],
  "rca owner": ["rca_owner", "root_cause_owner"],
  "task owner": ["task_owner", "procedure_update_owner", "training_owner", "inspection_owner", "action_owner"],
};

interface Person {
  id: number;
  email: string;
  roleName: string | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function emailsForValue(people: Person[], value: unknown): string[] {
  if (typeof value === "number" && Number.isFinite(value)) {
    const person = people.find((item) => item.id === value);
    return person ? [person.email] : [];
  }
  const raw = text(value);
  if (!raw) return [];
  if (raw.includes("@")) {
    const person = people.find((item) => item.email.toLowerCase() === raw.toLowerCase());
    return person ? [person.email] : [];
  }
  return people.filter((item) => roleTitleMatches(item.roleName, raw)).map((item) => item.email);
}

/** Turn stored titles into the emails of people whose assigned role matches. Never invents an address. */
export async function resolveNoticeEmails(
  db: Db,
  targets: string[],
  data: Record<string, unknown>,
  approverTitles: string[],
  assignedTo: number | null,
): Promise<string[]> {
  const people = await db
    .select({ id: users.id, email: users.email, roleName: roles.name, isActive: users.isActive })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.isActive, true)));
  const active: Person[] = [];
  for (const person of people) {
    if (typeof person.email === "string" && person.email.includes("@")) active.push({ id: person.id, email: person.email, roleName: person.roleName });
  }
  const found = new Set<string>();
  for (const target of targets) {
    const key = target.trim().toLowerCase();
    if (!key) continue;
    if (key === "approvers") {
      for (const title of approverTitles) for (const email of emailsForValue(active, title)) found.add(email);
      continue;
    }
    const fields = OWNER_FIELDS[key];
    if (fields) {
      let matched = false;
      for (const field of fields) {
        const emails = emailsForValue(active, data[field]);
        if (emails.length > 0) {
          matched = true;
          for (const email of emails) found.add(email);
        }
      }
      if (!matched && assignedTo != null) for (const email of emailsForValue(active, assignedTo)) found.add(email);
      continue;
    }
    for (const email of emailsForValue(active, target)) found.add(email);
  }
  return [...found];
}

export async function deliverInAppNotices(
  db: Db,
  notices: SlaNotice[],
  data: Record<string, unknown>,
  approverTitles: string[],
  assignedTo: number | null,
  ncrId: number,
): Promise<string[]> {
  const sent: string[] = [];
  for (const notice of notices) {
    const recipients = await resolveNoticeEmails(db, notice.targets, data, approverTitles, assignedTo);
    if (recipients.length === 0) continue;
    await notifyInApp(db, recipients, notice.subject, notice.body, "ncr", ncrId);
    sent.push(notice.key);
  }
  return sent;
}

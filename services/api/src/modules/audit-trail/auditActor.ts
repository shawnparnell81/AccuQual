import { eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { company } from "../../drizzle/schema/company.js";
import { users } from "../../drizzle/schema/users.js";
import { formatUserLabel } from "../users/userDisplay.js";

/** Who is acting and when, as plain words for an audit entry. The time is in the company's time zone. */
export async function whoAndWhen(db: Db, userId: number | null | undefined): Promise<{ label: string; when: string }> {
  const [profile] = await db.select({ profile: company.profile }).from(company).limit(1);
  const timeZone = profile?.profile?.timezone || "UTC";
  const when = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date());
  if (!userId) return { label: "An unknown person", when };
  const [person] = await db.select({ name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, userId));
  return { label: formatUserLabel(person ? { ...person, isActive: person.isActive ?? true } : undefined, userId), when };
}

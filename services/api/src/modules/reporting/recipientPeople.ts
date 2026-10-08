import { asc, eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { users } from "../../drizzle/schema/users.js";

export interface RecipientPerson {
  id: number;
  name: string;
  email: string;
}

/** Active people in this company, for the recipient picker. Names only — no roles. */
export async function listRecipientPeople(db: Db): Promise<RecipientPerson[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.name), asc(users.email));
  return rows.map((row) => ({
    id: row.id,
    name: row.name?.trim() || row.email,
    email: row.email,
  }));
}

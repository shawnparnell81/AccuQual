import { eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { users } from "../../drizzle/schema/users.js";
import { displayName, sortByDisplayOrder } from "../users/userDisplayOrder.js";

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
    .where(eq(users.isActive, true));
  const ordered = await sortByDisplayOrder(db, rows, (row) => row.id, (row) => displayName(row.name, row.email));
  return ordered.map((row) => ({
    id: row.id,
    name: row.name?.trim() || row.email,
    email: row.email,
  }));
}

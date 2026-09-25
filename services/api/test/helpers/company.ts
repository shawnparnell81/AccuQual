import { db } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";

/** The one company row every test runs against: returns it, creating it the first time. */
export async function ensureTestCompany() {
  const [existing] = await db.select().from(company).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(company).values({ name: "Test Company" }).returning();
  return created!;
}

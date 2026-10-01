import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { quarantineRecords } from "../../src/drizzle/schema/quarantine.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();
let qualityToken: string;

async function makeUser(department: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `q-notice-${department}-${suffix}@test.local`, passwordHash: "unused", department })
    .returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

const auth = () => ({ Authorization: `Bearer ${qualityToken}` });

describe("FRM-NCR-002 saves a quarantine hold", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    qualityToken = await makeUser("quality");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("persists a hold when the notice has a part and a quantity, and updates that same hold", async () => {
    const created = await request(app)
      .post("/iso-quality-forms")
      .set(auth())
      .send({
        formType: "quarantine_notice",
        data: { cells: { B6: "PN-441", B7: "LOT-9", B11: "Crack along the flange", A17: "Cage A", B17: 4, A18: "Cage B", B18: 1 } },
      });
    expect(created.status).toBe(201);

    const listed = await request(app).get("/quarantine").set(auth());
    expect(listed.status).toBe(200);
    const hold = (listed.body as { id: number; sourceType: string; sourceId: number; quantity: string; itemLabel: string; status: string }[]).find(
      (row) => row.sourceType === "frm-ncr-002" && row.sourceId === created.body.id,
    );
    expect(hold).toMatchObject({ itemLabel: "PN-441", status: "quarantined" });
    expect(Number(hold!.quantity)).toBe(5);

    const items = await request(app).get("/quarantine/items").set(auth()).query({ view: "active" });
    expect(items.status).toBe(200);
    expect((items.body as { id: number; partNumber: string }[]).some((row) => row.id === hold!.id && row.partNumber === "PN-441")).toBe(true);

    // ISO form saves merge cells, so Cage B (B18 = 1) stays when this patch only changes Cage A.
    const updated = await request(app)
      .patch(`/iso-quality-forms/${created.body.id}`)
      .set(auth())
      .send({ data: { cells: { B6: "PN-441", B11: "Crack along the flange", A17: "Cage A", B17: 6 } } });
    expect(updated.status).toBe(200);

    const again = await db
      .select()
      .from(quarantineRecords)
      .where(and(eq(quarantineRecords.sourceType, "frm-ncr-002"), eq(quarantineRecords.sourceId, created.body.id)));
    expect(again).toHaveLength(1);
    expect(Number(again[0]!.quantity)).toBe(7);
  });

  it("does not insert a hold for a blank notice", async () => {
    const created = await request(app).post("/iso-quality-forms").set(auth()).send({ formType: "quarantine_notice", data: { cells: {} } });
    expect(created.status).toBe(201);
    const rows = await db
      .select({ id: quarantineRecords.id })
      .from(quarantineRecords)
      .where(and(eq(quarantineRecords.sourceType, "frm-ncr-002"), eq(quarantineRecords.sourceId, created.body.id)));
    expect(rows).toHaveLength(0);
  });
});

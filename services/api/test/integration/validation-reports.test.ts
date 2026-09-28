import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { validationReports } from "../../src/drizzle/schema/validationReport.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { eq } from "drizzle-orm";

const app = createApp();
const suffix = Date.now();

let qualityToken: string;
let productionToken: string;

async function makeUser(department: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `val-report-${department}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" })
    .returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

describe("validation reports", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    qualityToken = await makeUser("quality");
    productionToken = await makeUser("production");
  });

  it("stores the filled cells and returns them", async () => {
    const created = await request(app).post("/validation-reports").set("Authorization", `Bearer ${qualityToken}`).send({ data: { cells: { B6: "CSA-100", D12: 10 } } });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const saved = await request(app)
      .patch(`/validation-reports/${id}`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ data: { cells: { B6: "CSA-100", D12: 8, E12: 10 } } });
    expect(saved.status).toBe(200);
    expect(saved.body.data.cells.D12).toBe(8);

    const again = await request(app).get(`/validation-reports/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(again.status).toBe(200);
    expect(again.body.data.cells.B6).toBe("CSA-100");
    expect(again.body.data.cells.E12).toBe(10);

    await db.delete(validationReports).where(eq(validationReports.id, id));
  });

  it("production can read a validation report and cannot change it", async () => {
    const created = await request(app).post("/validation-reports").set("Authorization", `Bearer ${qualityToken}`).send({});
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const read = await request(app).get(`/validation-reports/${id}`).set("Authorization", `Bearer ${productionToken}`);
    expect(read.status).toBe(200);

    const write = await request(app).patch(`/validation-reports/${id}`).set("Authorization", `Bearer ${productionToken}`).send({ data: { cells: { B6: "nope" } } });
    expect(write.status).toBe(403);

    const create = await request(app).post("/validation-reports").set("Authorization", `Bearer ${productionToken}`).send({});
    expect(create.status).toBe(403);

    await db.delete(validationReports).where(eq(validationReports.id, id));
  });
});

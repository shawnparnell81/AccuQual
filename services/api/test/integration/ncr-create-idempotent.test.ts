import { ensureTestCompany } from "../helpers/company.js";
// Bug L: a second click on "Create NCR" opened a duplicate NCR instead of
// returning the already-linked one. Both create paths are now idempotent per
// source path: the second POST returns 200 with the existing NCR.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { validationReports } from "../../src/drizzle/schema/validationReport.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let qualityToken: string;

const rows = [{ measurement: "Bore diameter", spec: "10.0 ± 0.1", actual: "10.4" }];

async function ncrCountForPath(path: string) {
  const found = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count FROM ncr
    WHERE is_deleted = false AND process_data->'validationSource'->>'path' = ${path}
  `);
  return Number(found.rows[0]?.count ?? 0);
}

describe("Create NCR is idempotent per source", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [user] = await db
      .insert(users)
      .values({ email: `ncr-dupe-${suffix}@test.local`, passwordHash: "unused" })
      .returning();
    qualityToken = signAccessToken({
      sub: String(user!.id),
      roleId: null,
      roleName: "operator",
      department: "quality",
    });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("second click on a validation report returns the linked NCR, no duplicate", async () => {
    const [report] = await db
      .insert(validationReports)
      .values({ data: { formType: "csa", cells: { B6: "DEMO-PART" } } })
      .returning();
    const id = report!.id;
    const path = `/validation-reports/${id}`;
    const auth = { Authorization: `Bearer ${qualityToken}` };

    const first = await request(app).post(`/validation-reports/${id}/ncr`).set(auth).send({ rows });
    expect(first.status).toBe(201);
    expect(first.body.existing).toBeUndefined();

    const second = await request(app).post(`/validation-reports/${id}/ncr`).set(auth).send({ rows });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.existing).toBe(true);

    expect(await ncrCountForPath(path)).toBe(1);
    const [row] = await db.select().from(ncr).where(eq(ncr.id, first.body.id));
    expect(row?.isDeleted).toBe(false);
  });

  it("second POST from an inspection form returns the existing NCR", async () => {
    const [fill] = await db
      .insert(formData)
      .values({ formType: "dimensional_report", entityId: 4242, data: {} })
      .returning();
    void fill;
    const path = `/dimensional_report/4242`;
    const auth = { Authorization: `Bearer ${qualityToken}` };
    const payload = {
      sourceKind: "form",
      formType: "dimensional_report",
      sourceId: 4242,
      formTitle: "Dimensional Report",
      path,
      part: "WIDGET",
      rows,
    };

    const first = await request(app).post("/ncr/from-inspection").set(auth).send(payload);
    expect(first.status).toBe(201);

    const second = await request(app).post("/ncr/from-inspection").set(auth).send(payload);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.existing).toBe(true);

    expect(await ncrCountForPath(path)).toBe(1);
  });
});

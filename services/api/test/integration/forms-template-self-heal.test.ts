import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Covers a real bug: a form type with no seeded form_templates row (any
// type added after a company was provisioned, or simply missing from
// platform.service.ts's DEFAULT_FORM_TYPES — customer_requirements and
// inventory_item both were) 404'd on every Preview/Export PDF forever, and
// that 404 came back as a generic, misleading "save it at least once first"
// toast because exportFormPdf's `responseType: "arraybuffer"` meant the
// real JSON error body arrived as raw bytes (see useWorkflowAction.ts's
// extractErrorMessage fix). forms.service.ts's loadTemplate now self-heals
// by auto-provisioning the default template on first real use.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { formTemplates, formData } from "../../src/drizzle/schema/forms.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();
const FORM_TYPE = `no-template-yet-${suffix}`; // a form type deliberately never seeded a template row

let companyId: number;
let userId: number;
let token: string;

describe("Forms engine — template self-healing (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;

    await seedDefaultPermissions(companyId);
    const [user] = await db.insert(users).values({ email: `forms-heal-test-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userId = user!.id;
    token = signAccessToken({ sub: String(userId), roleId: null, roleName: "operator", department: null });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("confirms no template row exists yet for this form type", async () => {
    const [row] = await db.select().from(formTemplates).where(and(eq(formTemplates.formType, FORM_TYPE)));
    expect(row).toBeUndefined();
  });

  it("saves a real form_data draft (the autosave path)", async () => {
    const res = await request(app).post(`/forms/${FORM_TYPE}/1/save`).set("Authorization", `Bearer ${token}`).send({ entityId: 1, data: { note: "real content" } });
    expect(res.status).toBe(200);
  });

  it("exports a real PDF WITHOUT a pre-seeded template — previously a 404, now self-heals", async () => {
    const res = await request(app).post(`/forms/${FORM_TYPE}/1/export`).set("Authorization", `Bearer ${token}`).responseType("blob");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect((res.body as Buffer).length).toBeGreaterThan(0);
    expect((res.body as Buffer).subarray(0, 4).toString("ascii")).toBe("%PDF"); // a real PDF, not a fabricated stub

    const [row] = await db.select().from(formTemplates).where(and(eq(formTemplates.formType, FORM_TYPE)));
    expect(row).toBeTruthy();
    expect(row!.isDefault).toBe("true");
  });

  it("a second export reuses the same self-healed template row rather than creating another", async () => {
    const res = await request(app).post(`/forms/${FORM_TYPE}/1/export`).set("Authorization", `Bearer ${token}`).responseType("blob");
    expect(res.status).toBe(200);

    const rows = await db.select().from(formTemplates).where(and(eq(formTemplates.formType, FORM_TYPE)));
    expect(rows.length).toBe(1);
  });
});

import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions, seedTestRoles } from "../helpers/seedDefaults.js";
import { setTestPin, TEST_PIN } from "../helpers/signaturePin.js";

const app = createApp();
const suffix = Date.now().toString(36);
const userIds: number[] = [];
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const co = await ensureTestCompany();
  await seedDefaultPermissions(co!.id);
  await seedTestRoles();
  const [role] = await db.select().from(roles).where(eq(roles.name, "quality_manager"));
  const [user] = await db.insert(users).values({ email: `iso-sign-${suffix}@test.local`, passwordHash: "unused", department: "quality", roleId: role!.id, name: "Sheet Signer" } as never).returning();
  userIds.push(user!.id);
  await setTestPin(user!.id);
  token = await signAccessToken({ sub: String(user!.id), roleId: role!.id, roleName: "quality_manager", department: "quality" });
});

afterAll(async () => {
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

const CASES: Array<[string, string]> = [
  ["ncr_report", "engineeringManagerSignature"],
  ["psw", "organizationSignature"],
  ["quality_alert", "approverSignature"],
  ["quality_alert", "extensionSignature"],
  ["first_article", "inspectorSignature"],
];

describe("ISO sheet signature rows use the PIN Sign control", () => {
  it.each(CASES)("%s %s: signs with the PIN, keeps the stamp on save, refuses a second sign and a wrong PIN", async (formType, field) => {
    const created = await request(app).post("/iso-quality-forms").set(auth()).send({ formType, data: { cells: { B6: `x-${suffix}` } } });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    const bad = await request(app).post(`/iso-quality-forms/${id}/sign`).set(auth()).send({ field, pin: "0000", certified: true });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const signed = await request(app).post(`/iso-quality-forms/${id}/sign`).set(auth()).send({ field, pin: TEST_PIN, certified: true });
    expect(signed.status).toBe(200);
    const stamp = signed.body.data[field] as string;
    expect(stamp).toContain("Sheet Signer");
    const saved = await request(app).patch(`/iso-quality-forms/${id}`).set(auth()).send({ data: { cells: { B6: "changed" }, [field]: "typed over" } });
    expect(saved.status).toBe(200);
    const read = await request(app).get(`/iso-quality-forms/${id}`).set(auth());
    expect(read.body.data[field]).toBe(stamp);
    const again = await request(app).post(`/iso-quality-forms/${id}/sign`).set(auth()).send({ field, pin: TEST_PIN, certified: true });
    expect(again.status).toBe(400);
  });

  it("leaves the header Approved By on Visitor Log and FRM-DEV as document data, not a record signature", async () => {
    for (const formType of ["visitor_log", "dev_csa"]) {
      const created = await request(app).post("/iso-quality-forms").set(auth()).send({ formType, data: { cells: {} } });
      const res = await request(app).post(`/iso-quality-forms/${created.body.id}/sign`).set(auth()).send({ field: "approvedSignature", pin: TEST_PIN, certified: true });
      expect(res.status).toBe(400);
    }
  });

  it("refuses a field that is not a signature row on that form", async () => {
    const created = await request(app).post("/iso-quality-forms").set(auth()).send({ formType: "psw", data: { cells: {} } });
    const res = await request(app).post(`/iso-quality-forms/${created.body.id}/sign`).set(auth()).send({ field: "approverSignature", pin: TEST_PIN, certified: true });
    expect(res.status).toBe(400);
  });
});

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
import { setTestPin } from "../helpers/signaturePin.js";

const app = createApp();
const suffix = Date.now().toString(36);
const userIds: number[] = [];
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

function binary(res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

beforeAll(async () => {
  const co = await ensureTestCompany();
  await seedDefaultPermissions(co!.id);
  await seedTestRoles();
  const [role] = await db.select().from(roles).where(eq(roles.name, "quality_manager"));
  const [user] = await db.insert(users).values({ email: `pdf-dl-${suffix}@test.local`, passwordHash: "unused", department: "quality", roleId: role!.id, name: "Pdf Tester" } as never).returning();
  userIds.push(user!.id);
  await setTestPin(user!.id);
  token = await signAccessToken({ sub: String(user!.id), roleId: role!.id, roleName: "quality_manager", department: "quality" });
});

afterAll(async () => {
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

function sheet(values: string[]) {
  return {
    version: 1, width: 800, height: 300,
    boxes: [{ x: 10, y: 10, w: 780, h: 40, bg: "rgb(255, 255, 255)", b: [{ w: 1, c: "rgb(0, 0, 0)", s: "solid" }, { w: 1, c: "rgb(0, 0, 0)", s: "solid" }, { w: 1, c: "rgb(0, 0, 0)", s: "solid" }, { w: 1, c: "rgb(0, 0, 0)", s: "solid" }] }],
    texts: values.map((t, i) => ({ x: 20, y: 20 + i * 20, w: 300, h: 16, t, size: 12, bold: false, italic: false, mono: false, serif: false, color: "rgb(0, 0, 0)", underline: false })),
    images: [], ticks: [], values, breaks: [50],
  };
}

describe("Download PDF for saved ISO and QMS forms", () => {
  it("ISO form: returns a PDF of the saved record and needs sign-in", async () => {
    const created = await request(app).post("/iso-quality-forms").set(auth()).send({ formType: "quality_alert", data: { cells: { B4: `Alert ${suffix}`, C9: "Hold lot 7" } } });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    const pdf = await request(app).post(`/iso-quality-forms/${id}/pdf`).set(auth()).send(sheet([`Alert ${suffix}`])).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    const after = await request(app).get(`/iso-quality-forms/${id}`).set(auth());
    expect(after.body.data?.cells?.B4).toBe(`Alert ${suffix}`);
    expect((await request(app).post(`/iso-quality-forms/${id}/pdf`).send(sheet([]))).status).toBe(401);
    expect((await request(app).post(`/iso-quality-forms/99999999/pdf`).set(auth()).send(sheet([]))).status).toBe(404);
    const unsaved = await request(app).post(`/iso-quality-forms/${id}/pdf`).set(auth()).send(sheet(["Typed but not saved"]));
    expect(unsaved.status).toBe(409);
    expect(JSON.stringify(unsaved.body)).toContain("Save your changes first");
    expect((await request(app).post(`/iso-quality-forms/${id}/pdf`).set(auth()).send({ version: 2 })).status).toBe(400);
  });

  it("QMS form: returns a PDF with the section rows and keeps the stored revision", async () => {
    const types = await request(app).get("/qms-forms/types").set(auth());
    const def = (types.body as { formType: string; sections: { key: string; columns: { key: string }[] }[] }[])[0]!;
    const created = await request(app).post("/qms-forms").set(auth()).send({ formType: def.formType });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    const before = created.body.revision;
    const section = def.sections[0]!;
    const row = await request(app).post(`/qms-forms/${id}/rows`).set(auth()).send({ sectionKey: section.key, data: { [section.columns[0]!.key]: `Row ${suffix}` } });
    expect(row.status).toBe(201);
    const pdf = await request(app).post(`/qms-forms/${id}/pdf`).set(auth()).send(sheet([`Row ${suffix}`])).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    const after = await request(app).get(`/qms-forms/${id}`).set(auth());
    expect(after.body.revision).toBe(before);
    expect((await request(app).post(`/qms-forms/${id}/pdf`).send(sheet([]))).status).toBe(401);
  });
});

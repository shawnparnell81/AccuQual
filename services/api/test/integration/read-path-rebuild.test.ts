import { ensureTestCompany } from "../helpers/company.js";
import { count, eq, max } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { controlledLists } from "../../src/drizzle/schema/controlledLists.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { formFilings } from "../../src/drizzle/schema/formFilings.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

let token: string;

async function snapshot() {
  const [folders] = await db.select({ n: count() }).from(documentFolders);
  const [filings] = await db.select({ n: count() }).from(formFilings);
  const [audits] = await db.select({ n: count() }).from(auditTrail);
  const [folderTouch] = await db.select({ at: max(documentFolders.updatedAt) }).from(documentFolders);
  return { folders: folders?.n ?? 0, filings: filings?.n ?? 0, audits: audits?.n ?? 0, folderTouch: folderTouch?.at?.toISOString() ?? null };
}

describe("list reads do not rebuild", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [admin] = await db.insert(users).values({ email: `read-path-${suffix}@test.local`, passwordHash: "unused", name: "Read Path" }).returning();
    token = signAccessToken({ sub: String(admin!.id), roleId: null, roleName: "admin", department: null });
    const warmed = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    expect(warmed.status).toBe(200);
    const folders = await request(app).get("/document-folders/form-folders").set("Authorization", `Bearer ${token}`);
    expect(folders.status).toBe(200);
    const list = await request(app).get("/controlled-lists/lst-eqp-001").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
  });

  it("opens Folders again without filing, relinking, or rebuilding", async () => {
    const before = await snapshot();
    const started = performance.now();
    const listed = await request(app).get("/document-folders/form-folders").set("Authorization", `Bearer ${token}`);
    const elapsed = performance.now() - started;
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body)).toBe(true);
    expect(listed.body.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
    expect(await snapshot()).toEqual(before);

    const detailStarted = performance.now();
    const detail = await request(app).get("/document-folders/form-folders/ncr").set("Authorization", `Bearer ${token}`);
    const detailElapsed = performance.now() - detailStarted;
    expect(detail.status).toBe(200);
    expect(detailElapsed).toBeLessThan(2000);
    expect(await snapshot()).toEqual(before);
  });

  it("opens the Master Equipment List again without retiring lists or rewriting the sheet", async () => {
    const before = await snapshot();
    const [row] = await db.select({ id: controlledLists.id, updatedAt: controlledLists.updatedAt }).from(controlledLists).where(eq(controlledLists.listKey, "lst-eqp-001"));
    expect(row?.id).toBeTruthy();
    const started = performance.now();
    const opened = await request(app).get("/controlled-lists/lst-eqp-001").set("Authorization", `Bearer ${token}`);
    const elapsed = performance.now() - started;
    expect(opened.status).toBe(200);
    expect(opened.body.listKey).toBe("lst-eqp-001");
    expect(opened.body.sheets.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
    const [after] = await db.select({ updatedAt: controlledLists.updatedAt }).from(controlledLists).where(eq(controlledLists.id, row!.id));
    expect(after?.updatedAt?.toISOString() ?? null).toBe(row?.updatedAt?.toISOString() ?? null);
    expect(await snapshot()).toEqual(before);
  });
});

import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

let qualityToken: string;
let productionToken: string;

describe("validation forms file into one Documents folder", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [quality] = await db.insert(users).values({ email: `val-file-q-${suffix}@test.local`, passwordHash: "unused" }).returning();
    const [production] = await db.insert(users).values({ email: `val-file-p-${suffix}@test.local`, passwordHash: "unused" }).returning();
    qualityToken = signAccessToken({ sub: String(quality!.id), roleId: null, roleName: "operator", department: "quality" });
    productionToken = signAccessToken({ sub: String(production!.id), roleId: null, roleName: "operator", department: "production" });
  });

  it("keeps one folder row for a CSA report and moves that same row", async () => {
    const created = await request(app).post("/validation-reports").set("Authorization", `Bearer ${qualityToken}`).send({ data: { formType: "csa", cells: { B6: "CSA-9" } } });
    expect(created.status).toBe(201);
    const recordId = created.body.id as number;

    const firstFolder = await request(app).post("/document-folders").set("Authorization", `Bearer ${qualityToken}`).send({ name: `CSA saves ${suffix}` });
    expect(firstFolder.status).toBe(201);
    const secondFolder = await request(app).post("/document-folders").set("Authorization", `Bearer ${qualityToken}`).send({ name: `CSA moved ${suffix}` });
    expect(secondFolder.status).toBe(201);

    const denied = await request(app)
      .post("/document-folders/form-filings")
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ formKey: "frm-val-001", recordId, folderId: firstFolder.body.id });
    expect(denied.status).toBe(403);

    const filed = await request(app)
      .post("/document-folders/form-filings")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ formKey: "frm-val-001", recordId, folderId: firstFolder.body.id });
    expect(filed.status).toBe(201);
    expect(filed.body.parentId).toBe(firstFolder.body.id);
    expect(filed.body.parentPath).toContain(`CSA saves ${suffix}`);
    expect(filed.body.fileName).toMatch(new RegExp(`^FRM-VAL-001_${recordId}_`));

    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const copies = (tree.body as { id: number; parentId: number | null; linkedPath: string | null }[]).filter((row) => row.linkedPath === `/validation-reports/${recordId}`);
    expect(copies).toHaveLength(1);
    expect(copies[0]?.parentId).toBe(firstFolder.body.id);
    expect(copies[0]?.id).toBe(filed.body.folderNodeId);

    const moved = await request(app)
      .post("/document-folders/form-filings")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ formKey: "frm-val-001", recordId, folderId: secondFolder.body.id });
    expect(moved.status).toBe(201);
    expect(moved.body.folderNodeId).toBe(filed.body.folderNodeId);
    expect(moved.body.parentId).toBe(secondFolder.body.id);

    const again = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const stillOne = (again.body as { linkedPath: string | null; parentId: number | null }[]).filter((row) => row.linkedPath === `/validation-reports/${recordId}`);
    expect(stillOne).toHaveLength(1);
    expect(stillOne[0]?.parentId).toBe(secondFolder.body.id);

    const wrongKind = await request(app)
      .post("/document-folders/form-filings")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ formKey: "frm-val-007", recordId, folderId: secondFolder.body.id });
    expect(wrongKind.status).toBe(404);
  });

  it("files a fuel pump validation into the chosen folder", async () => {
    const created = await request(app)
      .post("/validation-reports")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ data: { formType: "fuel_pump", cells: { B6: "FP-2" } } });
    expect(created.status).toBe(201);
    const recordId = created.body.id as number;
    const folder = await request(app).post("/document-folders").set("Authorization", `Bearer ${qualityToken}`).send({ name: `Pump saves ${suffix}` });
    const filed = await request(app)
      .post("/document-folders/form-filings")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ formKey: "frm-val-007", recordId, folderId: folder.body.id });
    expect(filed.status).toBe(201);
    expect(filed.body.parentId).toBe(folder.body.id);
    expect(filed.body.fileName).toMatch(new RegExp(`^FRM-VAL-007_${recordId}_`));

    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${qualityToken}`);
    const copies = (tree.body as { linkedPath: string | null }[]).filter((row) => row.linkedPath === `/validation-reports/${recordId}`);
    expect(copies).toHaveLength(1);
  });
});

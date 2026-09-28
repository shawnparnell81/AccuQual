import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, isNull } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { filedRecordName } from "../../src/modules/document-folders/formFiling.js";

const app = createApp();
const suffix = Date.now();

let token: string;

describe("ISO Compliance form templates", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [user] = await db
      .insert(users)
      .values({ email: `form-templates-${suffix}@test.local`, passwordHash: "unused" })
      .returning();
    token = signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department: "quality" });
    const [quality] = await db.select().from(documentFolders).where(and(isNull(documentFolders.parentId), eq(documentFolders.name, "Quality")));
    if (!quality) await db.insert(documentFolders).values({ name: "Quality", sortOrder: 0 });
  });

  it("files each blank template once under ISO Compliance and names a filled record from the pattern", async () => {
    expect(filedRecordName("FRM-VAL-007", 12, "2026-09-28")).toBe("FRM-VAL-007_12_2026-09-28");

    const first = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    const again = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${token}`);
    expect(again.body.templates).toHaveLength(first.body.templates.length);
    expect(first.body.fileNamePattern).toBe("{formId}_{recordNumber}_{date}");

    const templates = first.body.templates as { formKey: string; formId: string; title: string; subjectRoute: string; folderId: number; isoPath: string[] }[];
    const csa = templates.find((form) => form.formKey === "frm-val-001");
    const pump = templates.find((form) => form.formKey === "frm-val-007");
    const eightD = templates.find((form) => form.formKey === "8d");
    expect(csa?.formId).toBe("FRM-VAL-001");
    expect(pump?.formId).toBe("FRM-VAL-007");
    expect(csa?.isoPath).toEqual(["Quality", "Validation"]);
    expect(pump?.folderId).toBe(csa?.folderId);
    expect(csa?.subjectRoute).toBe("/folders/validation-reports");
    expect(eightD?.isoPath).toEqual(["Problem Solving"]);
    expect(eightD?.subjectRoute).toBe("/8d");
    expect(templates.filter((form) => form.formKey === "frm-val-001")).toHaveLength(1);

    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    expect(tree.status).toBe(200);
    const folders = tree.body as { id: number; name: string; parentId: number | null }[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance");
    const qualityTopic = folders.find((folder) => folder.parentId === iso?.id && folder.name === "Quality");
    const validation = folders.find((folder) => folder.parentId === qualityTopic?.id && folder.name === "Validation");
    expect(validation?.id).toBe(csa?.folderId);
    const rootQuality = folders.find((folder) => folder.parentId === null && folder.name === "Quality");
    expect(folders.find((folder) => folder.parentId === rootQuality?.id && folder.name === "Validation Reports")).toBeUndefined();
  });
});
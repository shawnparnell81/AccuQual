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

const app = createApp();
const suffix = Date.now();

let token: string;

describe("controlled form templates", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [user] = await db
      .insert(users)
      .values({ email: `controlled-forms-${suffix}@test.local`, passwordHash: "unused" })
      .returning();
    token = signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department: "quality" });
    const [quality] = await db.select().from(documentFolders).where(and(isNull(documentFolders.parentId), eq(documentFolders.name, "Quality")));
    if (!quality) await db.insert(documentFolders).values({ name: "Quality", sortOrder: 0 });
  });

  it("files each blank template once under ISO Compliance > Validation and lists that same row for the Forms Library", async () => {
    const first = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    const again = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${token}`);
    expect(again.body).toHaveLength(first.body.length);

    const forms = first.body as { formKey: string; docId: string; title: string; route: string; folderId: number | null }[];
    const csa = forms.find((form) => form.formKey === "frm-val-001");
    const pump = forms.find((form) => form.formKey === "frm-val-007");
    expect(csa?.docId).toBe("FRM-VAL-001");
    expect(csa?.title).toBe("CSA Validation Report");
    expect(pump?.docId).toBe("FRM-VAL-007");
    expect(pump?.title).toBe("Fuel Pump Validation");
    expect(csa?.route).toBe("/folders/validation-reports");
    expect(pump?.route).toBe("/folders/validation-reports");
    expect(forms.filter((form) => form.formKey === "frm-val-001")).toHaveLength(1);
    expect(forms.filter((form) => form.formKey === "frm-val-007")).toHaveLength(1);
    expect(csa).not.toHaveProperty("folderIds");
    expect(csa).not.toHaveProperty("categoryKeys");

    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    expect(tree.status).toBe(200);
    const folders = tree.body as { id: number; name: string; parentId: number | null }[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance");
    const quality = folders.find((folder) => folder.parentId === null && folder.name === "Quality");
    expect(iso).toBeTruthy();
    expect(quality).toBeTruthy();
    const validation = folders.find((folder) => folder.parentId === iso!.id && folder.name === "Validation");
    expect(validation).toBeTruthy();
    expect(csa?.folderId).toBe(validation!.id);
    expect(pump?.folderId).toBe(validation!.id);
    expect(folders.find((folder) => folder.parentId === iso!.id && folder.name === "Controlled Forms")).toBeUndefined();
    const qualityReports = folders.find((folder) => folder.parentId === quality!.id && folder.name === "Validation Reports");
    expect(qualityReports).toBeUndefined();
  });
});

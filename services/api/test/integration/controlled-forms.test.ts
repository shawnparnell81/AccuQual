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

  it("files each validation form in ISO Compliance, Validation Reports, and the Forms Library list", async () => {
    const first = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    const again = await request(app).get("/document-folders/form-templates").set("Authorization", `Bearer ${token}`);
    expect(again.body).toHaveLength(first.body.length);

    const forms = first.body as { formKey: string; docId: string; title: string; route: string; folderIds: number[]; categoryKeys: string[] }[];
    const csa = forms.find((form) => form.formKey === "frm-val-001");
    const pump = forms.find((form) => form.formKey === "frm-val-007");
    expect(csa?.docId).toBe("FRM-VAL-001");
    expect(csa?.title).toBe("CSA Validation Report");
    expect(pump?.docId).toBe("FRM-VAL-007");
    expect(pump?.title).toBe("Fuel Pump Validation");
    expect(csa?.route).toBe("/folders/validation-reports");
    expect(csa?.categoryKeys).toContain("validation-reports");
    expect(pump?.categoryKeys).toContain("validation-reports");

    const tree = await request(app).get("/document-folders").set("Authorization", `Bearer ${token}`);
    expect(tree.status).toBe(200);
    const folders = tree.body as { id: number; name: string; parentId: number | null }[];
    const iso = folders.find((folder) => folder.parentId === null && folder.name === "ISO Compliance");
    const quality = folders.find((folder) => folder.parentId === null && folder.name === "Quality");
    expect(iso).toBeTruthy();
    expect(quality).toBeTruthy();
    const controlled = folders.find((folder) => folder.parentId === iso!.id && folder.name === "Controlled Forms");
    const validation = folders.find((folder) => folder.parentId === quality!.id && folder.name === "Validation Reports");
    expect(controlled).toBeTruthy();
    expect(validation).toBeTruthy();
    expect(csa?.folderIds).toEqual(expect.arrayContaining([controlled!.id, validation!.id]));
    expect(pump?.folderIds).toEqual(expect.arrayContaining([controlled!.id, validation!.id]));
    expect(forms.filter((form) => form.formKey === "frm-val-001")).toHaveLength(1);
  });
});

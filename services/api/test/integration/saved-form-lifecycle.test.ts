import { ensureTestCompany } from "../helpers/company.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { documentFolders } from "../../src/drizzle/schema/documentFolders.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { FORM_TEMPLATES } from "../../src/modules/document-folders/formFiling.js";
import { FILEABLE_FORM_KEYS } from "../../src/modules/document-folders/editableForms.js";
import { formFolderIndex, RETIRED_FORM_FOLDER_KEYS } from "../../src/modules/document-folders/formFolders.js";

const app = createApp();
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

let adminToken: string;
let productionToken: string;
let folderId: number;

const HISTORY: Record<string, string> = {
  "/validation-reports": "validation_reports",
  "/iso-quality-forms": "iso_forms",
  "/qms-forms": "qms_forms",
  "/ncr": "ncr",
  "/capa": "capa",
  "/8d": "eight_d",
  "/risk": "risk",
  "/audits": "audit",
  "/equipment": "calibration",
  "/document-change-requests": "document_change_requests",
  "/training": "training_courses",
  "/change": "change",
};

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function apiPath(openPath: string): string {
  const calibration = openPath.match(/^\/calibration\/(\d+)$/);
  if (calibration) return `/equipment/${calibration[1]}`;
  const iso = openPath.match(/^\/iso-forms\/record\/(\d+)$/);
  if (iso) return `/iso-quality-forms/${iso[1]}`;
  const qms = openPath.match(/^\/qms-forms\/[^/]+\/(\d+)$/);
  if (qms) return `/qms-forms/${qms[1]}`;
  return openPath;
}

function editBody(createPath: string, body: Record<string, unknown>): { patch: Record<string, unknown>; marker: string } {
  if (createPath === "/validation-reports") {
    const data = (body.data ?? {}) as { formType?: string; cells?: Record<string, unknown> };
    return { patch: { data: { formType: data.formType, cells: { ...(data.cells ?? {}), B6: "LOCKED-EDIT" } } }, marker: "LOCKED-EDIT" };
  }
  if (createPath === "/iso-quality-forms") {
    const data = (body.data ?? {}) as { cells?: Record<string, unknown> };
    return { patch: { data: { ...(typeof body.data === "object" && body.data ? body.data : {}), cells: { ...(data.cells ?? {}), B6: "LOCKED-EDIT" } } }, marker: "LOCKED-EDIT" };
  }
  if (createPath === "/qms-forms" || createPath === "/document-change-requests") return { patch: { preparedBy: "Form Auditor" }, marker: "Form Auditor" };
  if (createPath === "/capa") return { patch: { rootCause: "Found the cause" }, marker: "Found the cause" };
  if (createPath === "/8d") return { patch: { problemDescriptionD2: { D2: "LOCKED-EDIT" } }, marker: "LOCKED-EDIT" };
  if (createPath === "/audits") return { patch: { name: `${String(body.name ?? "Audit")} edited` }, marker: "edited" };
  if (createPath === "/equipment") return { patch: { location: "Edited lab" }, marker: "Edited lab" };
  const title = typeof body.title === "string" ? `${body.title} edited` : "Record edited";
  return { patch: { title }, marker: "edited" };
}

function containsPath(value: unknown, path: string): boolean {
  if (value === path) return true;
  if (Array.isArray(value)) return value.some((item) => containsPath(item, path));
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some((item) => containsPath(item, path));
  return false;
}

describe("every saved form opens locked, keeps an audit, and leaves no ghost after delete", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [admin] = await db.insert(users).values({ email: `forms-admin-${suffix}@test.local`, passwordHash: "unused", name: "Form Auditor" }).returning();
    const [production] = await db.insert(users).values({ email: `forms-prod-${suffix}@test.local`, passwordHash: "unused", name: "Production Reader" }).returning();
    adminToken = signAccessToken({ sub: String(admin!.id), roleId: null, roleName: "admin", department: null });
    productionToken = signAccessToken({ sub: String(production!.id), roleId: null, roleName: "operator", department: "production" });
    const folder = await request(app).post("/document-folders").set(auth(adminToken)).send({ name: `Saved forms ${suffix}` });
    expect(folder.status).toBe(201);
    folderId = folder.body.id as number;
  });

  it("refuses edit to a department that can only read documents", async () => {
    const created = await request(app).post("/validation-reports").set(auth(adminToken)).send({ data: { formType: "csa", cells: {} } });
    expect(created.status).toBe(201);
    const denied = await request(app).post(`/validation-reports/${created.body.id}/begin-edit`).set(auth(productionToken));
    expect(denied.status).toBe(403);
    await request(app).delete(`/validation-reports/${created.body.id}`).set(auth(adminToken));
  });

  it(
    "creates, lists, opens, edits, audits, and deletes each registered form",
    async () => {
      const opened: string[] = [];
      // The folder index is the live registry. A retired form is left out here, not by naming it in this test.
      const activeKeys = new Set(formFolderIndex(FORM_TEMPLATES).flatMap((folder) => folder.formKeys));
      const forms = FORM_TEMPLATES.filter((seed) => seed.start != null && activeKeys.has(seed.formKey));
      const retired = FORM_TEMPLATES.filter((seed) => seed.start != null && RETIRED_FORM_FOLDER_KEYS.has(seed.formKey));
      expect(retired.length).toBeGreaterThan(0);
      expect(retired.every((seed) => !activeKeys.has(seed.formKey))).toBe(true);
      expect(forms.length).toBeGreaterThan(40);

      for (const seed of forms) {
        const start = seed.start!;
        const created = await request(app).post(start.createPath).set(auth(adminToken)).send(start.body);
        expect(created.status, `${seed.formKey} create ${JSON.stringify(created.body)}`).toBe(201);
        const id = created.body.id as number;
        const openPath = start.openPath.replaceAll("{id}", String(id));
        opened.push(openPath);

        if (FILEABLE_FORM_KEYS.has(seed.formKey)) {
          const filed = await request(app).post("/document-folders/form-filings").set(auth(adminToken)).send({ formKey: seed.formKey, recordId: id, folderId });
          expect(filed.status, `${seed.formKey} file ${JSON.stringify(filed.body)}`).toBe(201);
          const dead = openPath.startsWith("/validation-reports/") ? "/validation-reports/999999" : "/iso-forms/record/999999";
          await db
            .update(documentFolders)
            .set({ linkedPath: dead, ...(seed.formKey === "frm-val-001" ? { name: "CSA" } : {}) })
            .where(eq(documentFolders.id, filed.body.folderNodeId as number));
        }

        const folder = await request(app).get(`/document-folders/form-folders/${encodeURIComponent(seed.formKey)}`).set(auth(adminToken));
        expect(folder.status, `${seed.formKey} folder ${JSON.stringify(folder.body)}`).toBe(200);
        const fills = folder.body.fills as { recordId: number; openPath: string; fileName: string }[];
        const mine = fills.find((fill) => fill.recordId === id);
        expect(mine, seed.formKey).toBeTruthy();
        expect(mine?.openPath).toBe(openPath);

        if (FILEABLE_FORM_KEYS.has(seed.formKey)) {
          const tree = await request(app).get("/document-folders").set(auth(adminToken));
          const node = (tree.body as { linkedPath: string | null }[]).find((row) => row.linkedPath === openPath);
          expect(node, `${seed.formKey} explorer link`).toBeTruthy();
          const found = await request(app).get("/search").query({ q: mine?.fileName ?? seed.title }).set(auth(adminToken));
          expect(found.status).toBe(200);
          expect((found.body.results as { path: string }[]).some((row) => row.path === openPath), seed.formKey).toBe(true);
        }

        const loaded = await request(app).get(apiPath(openPath)).set(auth(adminToken));
        expect(loaded.status, `${seed.formKey} open ${JSON.stringify(loaded.body)}`).toBe(200);

        if (start.createPath === "/validation-reports" || start.createPath === "/iso-quality-forms" || start.createPath === "/qms-forms") {
          const started = await request(app).post(`${start.createPath}/${id}/begin-edit`).set(auth(adminToken));
          expect(started.status, seed.formKey).toBe(200);
        }

        const edit = editBody(start.createPath, start.body);
        const write = start.createPath === "/risk" ? request(app).put(`${start.createPath}/${id}`) : request(app).patch(`${start.createPath}/${id}`);
        const saved = await write.set(auth(adminToken)).send(edit.patch);
        expect(saved.status, `${seed.formKey} save ${JSON.stringify(saved.body)}`).toBe(200);

        const historyModule = HISTORY[start.createPath];
        expect(historyModule, seed.formKey).toBeTruthy();
        const history = await request(app).get(`/workflow/history/${historyModule}/${id}`).set(auth(adminToken));
        expect(history.status, `${seed.formKey} history ${JSON.stringify(history.body)}`).toBe(200);
        const text = JSON.stringify(history.body);
        expect(text, seed.formKey).toContain(edit.marker);
        expect(text, seed.formKey).toContain("Form Auditor");
        if (start.createPath === "/validation-reports" || start.createPath === "/iso-quality-forms" || start.createPath === "/qms-forms") {
          expect(text, seed.formKey).toContain("edit_started");
        }

        const removed = await request(app).delete(`${start.createPath}/${id}`).set(auth(adminToken));
        expect(removed.status, seed.formKey).toBe(204);

        const after = await request(app).get(`/document-folders/form-folders/${encodeURIComponent(seed.formKey)}`).set(auth(adminToken));
        const still = (after.body.fills as { recordId: number }[]).some((fill) => fill.recordId === id);
        expect(still, seed.formKey).toBe(false);
        const tree = await request(app).get("/document-folders").set(auth(adminToken));
        expect((tree.body as { linkedPath: string | null }[]).some((row) => row.linkedPath === openPath), seed.formKey).toBe(false);
        const search = await request(app).get("/search").query({ q: String(id) }).set(auth(adminToken));
        expect((search.body.results as { path: string }[]).some((row) => row.path === openPath), seed.formKey).toBe(false);
        const gone = await request(app).get(apiPath(openPath)).set(auth(adminToken));
        expect(gone.status, seed.formKey).toBe(404);
      }

      const overview = await request(app).get("/dashboard/overview").set(auth(adminToken));
      expect(overview.status).toBe(200);
      const waiting = await request(app).get("/dashboard/waiting-on-me").set(auth(adminToken));
      expect(waiting.status).toBe(200);
      for (const path of opened) {
        expect(containsPath(overview.body, path), path).toBe(false);
        expect(containsPath(waiting.body, path), path).toBe(false);
      }
    },
    180_000,
  );
});

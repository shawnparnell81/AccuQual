import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, desc, eq, sql } from "drizzle-orm";
import { ensureTestCompany } from "./helpers/company.js";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { env } from "../src/config/env.js";
import { users } from "../src/drizzle/schema/users.js";
import { auditTrail } from "../src/drizzle/schema/auditTrail.js";
import { attachments } from "../src/drizzle/schema/attachments.js";
import { documentFolders } from "../src/drizzle/schema/documentFolders.js";
import { qualityEngineeringReports } from "../src/drizzle/schema/qualityEngineeringReport.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { seedDefaultPermissions, seedTestRoles } from "./helpers/seedDefaults.js";
import { EICAR, EICAR_VIRUS_NAME, startFakeClamd, type FakeClamd } from "./helpers/fakeClamd.js";
import { assertUploadClean } from "../src/modules/upload-scan/uploadScan.js";
import { storeReportImages } from "../src/modules/quality-engineering-report/reportImages.js";

const here = dirname(fileURLToPath(import.meta.url));
const docx = readFileSync(join(here, "fixtures", "monthly-quality-report-september-2026.docx"));

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let clamd: FakeClamd;
let adminToken: string;
let adminId: number;
let folderId: number;
const FOLDER_NAME = "Procedures QA";
const userIds: number[] = [];
const saved = { enabled: process.env.VIRUS_SCAN_ENABLED, host: process.env.CLAMD_HOST, port: process.env.CLAMD_PORT };

const BLOCKED = `This file was blocked because it contains a virus: ${EICAR_VIRUS_NAME}.`;
const UNAVAILABLE = "Virus scanning is unavailable right now, please try again shortly.";

interface UploadRoute {
  name: string;
  path: string;
  fields?: Record<string, string>;
  /** For a route that reads a JSON payload next to the file. */
  payload?: Record<string, unknown>;
}

/** Every route that takes an uploaded file. */
const ROUTES: UploadRoute[] = [
  { name: "General Uploads", path: "/attachments" },
  { name: "record attachments (and avatars)", path: "/attachments", fields: { entityType: "ncr", entityId: "1" } },
  { name: "Folder Explorer upload", path: "/document-folders/upload", fields: { parentId: "FOLDER" } },
  { name: "Folder Explorer template", path: "/document-folders/FOLDER/template" },
  { name: "document attachment", path: "/documents/1/version/1/attachments" },
  { name: "Form Builder Word import", path: "/form-builder/import-docx" },
  { name: "blank form template", path: "/forms/ncr/template" },
  { name: "Import from file: extract", path: "/form-import/extract" },
  { name: "Import from file: inspect", path: "/form-import/inspect", fields: { templateKey: "x" } },
  { name: "Import from file: confirm", path: "/form-import/confirm", payload: { targetRef: "report:monthly-quality" } },
  { name: "data import preview", path: "/import/suppliers/preview" },
  { name: "data import run", path: "/import/suppliers/run" },
  { name: "admin import", path: "/admin/imports", fields: { type: "suppliers" } },
  { name: "Monthly Quality Report supplier file", path: "/reports/engineering/upload", fields: { year: "2027", month: "5", replaceNotes: "true" } },
  { name: "calibration certificate", path: "/equipment/calibration/1/certificate" },
  { name: "training certificate", path: "/training/assignment/1/certificate" },
  { name: "warranty claim document", path: "/warranty/claims/1/upload" },
  { name: "supplier onboarding document", path: "/supplier-portal/onboarding/upload" },
  { name: "supplier document", path: "/supplier-portal/documents/upload" },
  { name: "supplier PPAP document", path: "/supplier-portal/ppap/1/documents" },
];

function post(route: UploadRoute, body: Buffer, fileName: string) {
  let req = request(app).post(route.path.replace("FOLDER", String(folderId))).set("Authorization", `Bearer ${adminToken}`);
  if (route.payload) req = req.field("payload", JSON.stringify(route.payload));
  for (const [key, value] of Object.entries(route.fields ?? {})) req = req.field(key, value === "FOLDER" ? String(folderId) : value);
  return req.attach("file", body, fileName);
}

function filesUnder(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    count += statSync(full).isDirectory() ? filesUnder(full) : 1;
  }
  return count;
}

async function counts() {
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(attachments);
  const [f] = await db.select({ n: sql<number>`count(*)::int` }).from(documentFolders);
  const [q] = await db.select({ n: sql<number>`count(*)::int` }).from(qualityEngineeringReports);
  return { attachments: a!.n, folders: f!.n, reports: q!.n, files: filesUnder(resolve(env.STORAGE_LOCAL_PATH)) };
}

async function blockedEntries() {
  return db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "UploadBlocked"), eq(auditTrail.performedBy, adminId))).orderBy(desc(auditTrail.id));
}

beforeAll(async () => {
  clamd = await startFakeClamd();
  process.env.VIRUS_SCAN_ENABLED = "true";
  process.env.CLAMD_HOST = "127.0.0.1";
  process.env.CLAMD_PORT = String(clamd.port);
  const co = await ensureTestCompany();
  await seedDefaultPermissions(co!.id);
  await seedTestRoles();
  const [admin] = await db.insert(users).values({ email: `scan-admin-${suffix}@test.local`, passwordHash: "unused", name: "Scan Tester", department: "quality" }).returning();
  adminId = admin!.id;
  userIds.push(adminId);
  adminToken = await signAccessToken({ sub: String(adminId), roleId: null, roleName: "admin", department: "quality" });
  const [folder] = await db.insert(documentFolders).values({ name: FOLDER_NAME }).returning();
  folderId = folder!.id;
});

afterAll(async () => {
  await clamd.close();
  for (const [key, value] of [["VIRUS_SCAN_ENABLED", saved.enabled], ["CLAMD_HOST", saved.host], ["CLAMD_PORT", saved.port]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await db.delete(documentFolders).where(eq(documentFolders.id, folderId));
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

describe("an infected file is blocked on every upload route", () => {
  for (const route of ROUTES) {
    it(`${route.name}: EICAR is refused, nothing is stored, the block is audit-logged`, async () => {
      const before = await counts();
      const auditBefore = (await blockedEntries()).length;
      const scansBefore = clamd.scans();

      const res = await post(route, Buffer.from(EICAR), "invoice.docx");
      expect(res.status).toBe(422);
      expect(res.body.message ?? res.body.error).toContain(BLOCKED);

      expect(clamd.scans()).toBe(scansBefore + 1);
      expect(await counts()).toEqual(before);
      const entries = await blockedEntries();
      expect(entries.length).toBe(auditBefore + 1);
      const summary = String((entries[0]!.changes as { summary: string }).summary);
      expect(summary).toContain(`Upload by Scan Tester blocked: 'invoice.docx' contained ${EICAR_VIRUS_NAME} (`);
      expect(summary).not.toMatch(/\b\d{5,}\b/);
    });
  }

  it("a Folder Explorer block names the folder", async () => {
    const entry = (await blockedEntries()).find((row) => String((row.changes as { where?: string }).where).startsWith("Folder Explorer >"));
    expect(String((entry!.changes as { summary: string }).summary)).toContain(`(Folder Explorer > ${FOLDER_NAME})`);
  });
});

describe("a clean file is not blocked", () => {
  it("passes the scan on every upload route (the route's own checks then run)", async () => {
    for (const route of ROUTES) {
      const scans = clamd.scans();
      const res = await post(route, Buffer.from("A perfectly ordinary file."), "notes.txt");
      expect(res.status, route.name).not.toBe(422);
      expect(res.status, route.name).not.toBe(503);
      expect(clamd.scans(), route.name).toBe(scans + 1);
    }
  });

  it("still uploads: a general upload, a Folder Explorer document and the Monthly Quality Report Word file", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
    const general = await request(app).post("/attachments").set("Authorization", `Bearer ${adminToken}`).attach("file", pdf, "clean.pdf");
    expect(general.status).toBe(201);
    await db.delete(attachments).where(eq(attachments.id, general.body.id));

    const folder = await request(app).post("/document-folders/upload").set("Authorization", `Bearer ${adminToken}`).field("parentId", String(folderId)).attach("file", pdf, "clean.pdf");
    expect(folder.status).toBe(201);
    await db.delete(documentFolders).where(eq(documentFolders.id, folder.body.id));

    const report = await post(ROUTES.find((r) => r.name.startsWith("Monthly Quality"))!, docx, "report.docx");
    expect(report.status).toBe(200);
    await db.delete(qualityEngineeringReports).where(and(eq(qualityEngineeringReports.year, 2027), eq(qualityEngineeringReports.month, 5)));
  });
});

describe("the scanner failing closes the door", () => {
  it("rejects the upload when clamd drops the connection or answers with an error, and stores nothing", async () => {
    for (const mode of ["drop", "error-reply"] as const) {
      clamd.setMode(mode);
      const before = await counts();
      const auditBefore = (await blockedEntries()).length;
      const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
      const res = await request(app).post("/attachments").set("Authorization", `Bearer ${adminToken}`).attach("file", pdf, "clean.pdf");
      expect(res.status).toBe(503);
      expect(res.body.message ?? res.body.error).toContain(UNAVAILABLE);
      expect(await counts()).toEqual(before);
      const entries = await blockedEntries();
      expect(entries.length).toBe(auditBefore + 1);
      expect(String((entries[0]!.changes as { summary: string }).summary)).toContain("could not be scanned because virus scanning was unavailable");
    }
    clamd.setMode("normal");
  });

  it("rejects the upload when clamd is not running at all", async () => {
    const live = process.env.CLAMD_PORT;
    process.env.CLAMD_PORT = "1";
    try {
      const res = await request(app).post("/attachments").set("Authorization", `Bearer ${adminToken}`).attach("file", Buffer.from("%PDF-1.4\n"), "clean.pdf");
      expect(res.status).toBe(503);
      expect(res.body.message ?? res.body.error).toContain(UNAVAILABLE);
    } finally {
      process.env.CLAMD_PORT = live;
    }
  }, 20_000);
});

describe("scanner status for Admin (System Health)", () => {
  it("shows scanning on, clamd up and the definitions date to an Admin, and nobody else", async () => {
    const res = await request(app).get("/system-health").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const check = res.body.checks.virusScanner;
    expect(check).toMatchObject({ status: "ok", enabled: true, up: true, engine: "ClamAV 1.4.6", definitionsVersion: "28152" });
    expect(new Date(check.definitionsDate).getTime()).toBeGreaterThan(Date.now() - 24 * 60 * 60 * 1000);

    const operator = await db.insert(users).values({ email: `scan-op-${suffix}@test.local`, passwordHash: "unused", department: "quality" }).returning();
    userIds.push(operator[0]!.id);
    const operatorToken = await signAccessToken({ sub: String(operator[0]!.id), roleId: null, roleName: "operator", department: "quality" });
    expect((await request(app).get("/system-health").set("Authorization", `Bearer ${operatorToken}`)).status).toBe(403);
    // The public health body does not carry scanner details.
    const open = await request(app).get("/health");
    expect(JSON.stringify(open.body)).not.toMatch(/clam|definitions/i);
  });

  it("reports the scanner down (critical) when clamd is not reachable, and off when scanning is turned off", async () => {
    const live = process.env.CLAMD_PORT;
    process.env.CLAMD_PORT = "1";
    try {
      const down = await request(app).get("/system-health").set("Authorization", `Bearer ${adminToken}`);
      expect(down.body.checks.virusScanner).toMatchObject({ status: "critical", enabled: true, up: false });
      expect(down.body.overall).toBe("critical");
    } finally {
      process.env.CLAMD_PORT = live;
    }
    process.env.VIRUS_SCAN_ENABLED = "false";
    try {
      const off = await request(app).get("/system-health").set("Authorization", `Bearer ${adminToken}`);
      expect(off.body.checks.virusScanner).toMatchObject({ enabled: false, up: false });
    } finally {
      process.env.VIRUS_SCAN_ENABLED = "true";
    }
  });
});

describe("VIRUS_SCAN_ENABLED=false", () => {
  it("skips scanning, so local development and tests run without ClamAV", async () => {
    process.env.VIRUS_SCAN_ENABLED = "false";
    try {
      const scans = clamd.scans();
      const res = await request(app).post("/attachments").set("Authorization", `Bearer ${adminToken}`).attach("file", Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"), "x.pdf");
      expect(res.status).not.toBe(422);
      expect(res.status).not.toBe(503);
      expect(clamd.scans()).toBe(scans);
      if (res.status === 201) await db.delete(attachments).where(eq(attachments.id, res.body.id));
    } finally {
      process.env.VIRUS_SCAN_ENABLED = "true";
    }
  });
});

describe("files that do not arrive through an upload route", () => {
  it("scans each picture pulled out of a Word report, before anything is stored", async () => {
    const before = await counts();
    await expect(
      storeReportImages(db, {
        reportId: 999999,
        images: [{ order: 1, section: null, fileName: "chart.png", mimeType: "image/png", caption: "", bytes: Buffer.from(EICAR) }],
        existing: [],
        replace: false,
        uploadedBy: adminId,
      }),
    ).rejects.toThrow(BLOCKED);
    expect(await counts()).toEqual(before);
  });

  it("assertUploadClean refuses an infected buffer and passes a clean one", async () => {
    await expect(assertUploadClean({ buffer: Buffer.from(EICAR), fileName: "saved.docx", userId: adminId, where: "Documents > editor save" })).rejects.toThrow(BLOCKED);
    await expect(assertUploadClean({ buffer: Buffer.from("fine"), fileName: "saved.docx", userId: adminId, where: "Documents > editor save" })).resolves.toBeUndefined();
  });

  it("the editor save scans before it writes the replacement file", () => {
    const source = readFileSync(join(here, "..", "src", "modules", "onlyoffice", "access.ts"), "utf8");
    const body = source.slice(source.indexOf("export async function persistEditedOfficeFile"));
    expect(body.indexOf("assertUploadClean(")).toBeGreaterThan(0);
    expect(body.indexOf("assertUploadClean(")).toBeLessThan(body.indexOf("await writeFile(nextPath"));
  });

  it("every upload route in the API has the scan step right after its multer step", () => {
    const root = join(here, "..", "src", "modules");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(routes|controller)\.ts$|routes\.ts$|controller\.ts$/.test(entry)) {
          const text = readFileSync(full, "utf8");
          for (const match of text.matchAll(/(upload|importUpload)\.single\("file"\)|\buploadImportFile\b(?=,)|\bconfirmUploadFile\b(?=,)/g)) {
            const lineStart = text.lastIndexOf("\n", match.index!) + 1;
            const line = text.slice(lineStart, text.indexOf("\n", match.index!));
            if (!/\.post\(|upload\.single/.test(line)) continue; // an import statement, not a route
            const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 60);
            if (!/^\s*,?\s*scanUploads\(/.test(after)) offenders.push(`${full.replace(root, "")}: ${match[0]} -> ${after.replace(/\s+/g, " ").slice(0, 40)}`);
          }
        }
      }
    };
    walk(root);
    // The multer steps themselves (definitions inside a controller) are not routes; only route chains are checked.
    expect(offenders.filter((line) => !/formImport\.controller\.ts|adminImport\.controller\.ts/.test(line))).toEqual([]);
  });
});

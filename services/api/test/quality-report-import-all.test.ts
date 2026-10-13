import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { ensureTestCompany } from "./helpers/company.js";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { users } from "../src/drizzle/schema/users.js";
import { ncr } from "../src/drizzle/schema/ncr.js";
import { auditTrail } from "../src/drizzle/schema/auditTrail.js";
import { attachments } from "../src/drizzle/schema/attachments.js";
import { qualityEngineeringReports } from "../src/drizzle/schema/qualityEngineeringReport.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { seedDefaultPermissions } from "./helpers/seedDefaults.js";
import { pdfDrawnText, pdfImageCount } from "./helpers/pdfText.js";
import { extractFile, extractFileWithImages } from "../src/modules/form-import/extract.js";
import { proposeMonthlyQuality } from "../src/modules/form-import/reportTargets/monthlyQuality.js";
import { officePackage } from "../src/modules/form-builder/docx.js";
import { renderEngineeringReportPdf } from "../src/modules/quality-engineering-report/pdf.js";
import { loadReportImageFiles } from "../src/modules/quality-engineering-report/reportImages.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FIXTURES = ["monthly-quality-report-september-2026.docx", "RPT-ENG-2026-08-monthly-quality-report-august.docx"].filter((name) => existsSync(join(fixturesDir, name)));
const docx = readFileSync(join(fixturesDir, "monthly-quality-report-september-2026.docx"));

const OLD_WARNINGS = [/NCR table is not imported/i, /NCRs\/CARs\/PIRs\/RPNs is not imported/i, /Email Issues is not imported/i, /image\(s\) in this file are not imported/i];

const app = createApp();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const YEAR = 2026;
const UPLOAD_MONTH = 12;
const IMPORT_MONTH = 10;
let editToken: string;
let noAccessToken: string;
const userIds: number[] = [];

async function makeUser(department: string | null, label: string) {
  const [user] = await db.insert(users).values({ email: `qr-all-${label}-${suffix}@test.local`, passwordHash: "unused", name: `Import Tester ${label}` }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function reportRow(month: number) {
  const [row] = await db.select().from(qualityEngineeringReports).where(and(eq(qualityEngineeringReports.year, YEAR), eq(qualityEngineeringReports.month, month)));
  return row;
}

async function imageRows(reportId: number) {
  return db.select().from(attachments).where(and(eq(attachments.entityType, "quality_engineering_report"), eq(attachments.entityId, reportId)));
}

async function cleanMonth(month: number) {
  const row = await reportRow(month);
  if (!row) return;
  const rows = await imageRows(row.id);
  if (rows.length) await db.delete(attachments).where(inArray(attachments.id, rows.map((r) => r.id)));
  await db.delete(qualityEngineeringReports).where(eq(qualityEngineeringReports.id, row.id));
}

const upload = (token: string, file: Buffer, name: string, replace: boolean) =>
  request(app)
    .post("/reports/engineering/upload")
    .set(bearer(token))
    .field("year", String(YEAR))
    .field("month", String(UPLOAD_MONTH))
    .field("replaceNotes", String(replace))
    .attach("file", file, name);

beforeAll(async () => {
  const co = await ensureTestCompany();
  await seedDefaultPermissions(co!.id);
  editToken = await makeUser("quality", "edit");
  noAccessToken = await makeUser(null, "none");
  await cleanMonth(UPLOAD_MONTH);
  await cleanMonth(IMPORT_MONTH);
});

afterAll(async () => {
  await cleanMonth(UPLOAD_MONTH);
  await cleanMonth(IMPORT_MONTH);
  for (const id of userIds) await db.delete(users).where(eq(users.id, id)).catch(() => {});
});

/* ---------- a small Word file built here: email-issue text, a caption, an emf and an oversize picture ---------- */

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const EMF = Buffer.concat([Buffer.from([0x01, 0x00, 0x00, 0x00, 0x6c, 0x00, 0x00, 0x00]), Buffer.alloc(64)]);
const HUGE = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 1024)]);

function drawing(relId: string, alt: string): string {
  return `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture" descr="${alt}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${relId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function smallReport(): Buffer {
  const para = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${para("Monthly Quality Report - November 2026", "Title")}
${para("6.9 - OR/NAPA Email Issues", "Heading2")}
${para("Three orders shipped to the wrong store after a template error.")}
${drawing("rId20", "Alt text for the chart")}
${para("Figure 1. Email issues by week", "Caption")}
${drawing("rId21", "A metafile")}
${drawing("rId22", "Too big")}
${drawing("rId23", "A gif")}
</w:body></w:document>`;
  const image = (id: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${target}"/>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${image("rId20", "chart.png")}${image("rId21", "drawing.emf")}${image("rId22", "huge.png")}${image("rId23", "spinner.gif")}</Relationships>`;
  return officePackage([
    { name: "[Content_Types].xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`) },
    { name: "_rels/.rels", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: "word/document.xml", data: Buffer.from(document) },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(rels) },
    { name: "word/media/chart.png", data: PNG },
    { name: "word/media/drawing.emf", data: EMF },
    { name: "word/media/huge.png", data: HUGE },
    { name: "word/media/spinner.gif", data: GIF },
  ]);
}

describe.each(FIXTURES)("extract + propose on %s", (name) => {
  it("returns only png pictures, each with a section and an order, and none of the old not-imported warnings", async () => {
    const buffer = readFileSync(join(fixturesDir, name));
    const { file, images } = await extractFileWithImages(buffer, name);
    expect(images.length).toBeGreaterThan(0);
    expect(file.images).toBeGreaterThanOrEqual(images.length);
    expect(images.map((image) => image.order)).toEqual(images.map((_, index) => index + 1));
    for (const image of images) {
      expect(image.mimeType).toBe("image/png");
      expect(image.bytes.length).toBeGreaterThan(0);
      expect(image.section).toBeTruthy();
    }
    const { warnings } = proposeMonthlyQuality(file);
    for (const pattern of OLD_WARNINGS) expect(warnings.some((warning) => pattern.test(warning))).toBe(false);
    expect(file.imageMeta?.every((meta) => !("bytes" in meta))).toBe(true);
  });
});

describe("the September report", () => {
  it("extracts 4 png pictures with sections and order", async () => {
    const { images } = await extractFileWithImages(docx, "september.docx");
    expect(images).toHaveLength(4);
    expect(images.every((image) => image.mimeType === "image/png")).toBe(true);
    expect(images.map((image) => image.order)).toEqual([1, 2, 3, 4]);
    expect(images.every((image) => typeof image.section === "string" && image.section.length > 0)).toBe(true);
  });

  it("proposes the NCR table, the NCR notes and the email-issues field, with no not-imported warnings", async () => {
    const { proposals, warnings } = proposeMonthlyQuality(await extractFile(docx, "september.docx"));
    const byKey = new Map(proposals.map((proposal) => [proposal.key, proposal]));
    expect(byKey.get("ncr_table")!.value).toEqual([
      ["NCR Number", "Part Number", "Description of Defect", "Disposition", "Status"],
      ["NCR-2026-065", "CS5477", "P3 Slightly out of spec", "Use-As-Is", "Closed"],
      ["NCR-2026-066", "[Unassigned]", "Hardware ungraded", "Use-As-Is", "Open"],
    ]);
    expect(String(byKey.get("notes.ncr")!.value)).toContain("Total September NCRs Logged: 2");
    expect(byKey.has("notes.email_issues")).toBe(true);
    for (const pattern of OLD_WARNINGS) expect(warnings.some((warning) => pattern.test(warning))).toBe(false);
  });
});

describe("a small Word file with email-issue text, an emf and an oversize picture", () => {
  it("imports the text and a caption, and skips the emf and the oversize picture with a warning naming each", async () => {
    const { file, images } = await extractFileWithImages(smallReport(), "small.docx");
    const { proposals, warnings } = proposeMonthlyQuality(file);
    expect(proposals.find((proposal) => proposal.key === "notes.email_issues")!.value).toBe("Three orders shipped to the wrong store after a template error.");
    expect(images.map((image) => [image.fileName, image.mimeType])).toEqual([["chart.png", "image/png"], ["spinner.gif", "image/gif"]]);
    expect(images[0]!.caption).toBe("Figure 1. Email issues by week");
    expect(images[0]!.section).toBe("6.9 - OR/NAPA Email Issues");
    expect(images[1]!.caption).toBe("A gif");
    expect(warnings.some((warning) => warning.includes("drawing.emf"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("huge.png") && /5 MB/.test(warning))).toBe(true);
    expect(warnings).toHaveLength(2);
  });

  it("does not turn the caption paragraph into section text", async () => {
    const { proposals } = proposeMonthlyQuality(await extractFile(smallReport(), "small.docx"));
    expect(String(proposals.find((proposal) => proposal.key === "notes.email_issues")!.value)).not.toContain("Figure 1");
  });
});

describe("POST /reports/engineering/upload with the September report", () => {
  it("fills the NCR table, NCR notes and pictures, stores the pictures as attachments, and writes nothing to the NCR module", async () => {
    const ncrBefore = (await db.select({ id: ncr.id }).from(ncr)).length;
    const res = await upload(editToken, docx, "september-report.docx", true);
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);

    const got = await request(app).get("/reports/engineering").query({ year: YEAR, month: UPLOAD_MONTH }).set(bearer(editToken));
    expect(got.status).toBe(200);
    const narrative = got.body.narrative;
    expect(narrative.ncrTableRows).toHaveLength(2);
    expect(narrative.ncrTableRows[0]).toEqual({ ncrNumber: "NCR-2026-065", partNumber: "CS5477", description: "P3 Slightly out of spec", disposition: "Use-As-Is", status: "Closed" });
    expect(narrative.ncrTableRows[1].partNumber).toBe("[Unassigned]");
    expect(narrative.ncrNotes).toContain("Total September NCRs Logged: 2");
    expect(narrative.images).toHaveLength(4);

    const row = await reportRow(UPLOAD_MONTH);
    const stored = await imageRows(row!.id);
    expect(stored).toHaveLength(4);
    for (const image of narrative.images) {
      const file = await request(app).get(`/attachments/${image.attachmentId}/download`).set(bearer(editToken));
      expect(file.status).toBe(200);
      expect(String(file.headers["content-type"])).toMatch(/^image\/png/);
    }
    expect((await db.select({ id: ncr.id }).from(ncr)).length).toBe(ncrBefore);
  });

  it("audit-logs the upload in plain words", async () => {
    const row = await reportRow(UPLOAD_MONTH);
    const entries = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "QualityEngineeringReport"), eq(auditTrail.entityId, row!.id)));
    const entry = entries.filter((e) => JSON.stringify(e.changes).includes("september-report.docx")).pop();
    expect(entry).toBeTruthy();
    expect(entry!.performedBy).not.toBeNull();
    const summary = String((entry!.changes as { summary: string }).summary);
    expect(summary).toContain("2 NCR rows");
    expect(summary).toContain("NCR notes");
    expect(summary).toContain("4 images");
    expect(summary).toContain("December 2026 Monthly Quality Report");
    expect(summary).not.toMatch(/\b\d{5,}\b/);
  });

  it("refuses a user without the report permission on upload and on picture download", async () => {
    expect((await upload(noAccessToken, docx, "x.docx", false)).status).toBe(403);
    const row = await reportRow(UPLOAD_MONTH);
    const [first] = await imageRows(row!.id);
    expect((await request(app).get(`/attachments/${first!.id}/download`).set(bearer(noAccessToken))).status).toBe(403);
    expect((await request(app).get("/attachments").query({ entityType: "quality_engineering_report", entityId: row!.id }).set(bearer(noAccessToken))).status).toBe(403);
  });

  it("keeps typed text, edited NCR rows and pictures with replace off, and overwrites them with replace on", async () => {
    const before = await request(app).get("/reports/engineering").query({ year: YEAR, month: UPLOAD_MONTH }).set(bearer(editToken));
    const original = before.body.narrative;
    const edited = {
      ...original,
      ncrNotes: "Typed by hand",
      emailIssuesNotes: "Typed email note",
      ncrTableRows: [{ ...original.ncrTableRows[0], description: "EDITED BY HAND" }, ...original.ncrTableRows.slice(1)],
    };
    const saved = await request(app).put("/reports/engineering").set(bearer(editToken)).send({ year: YEAR, month: UPLOAD_MONTH, narrative: edited });
    expect(saved.status).toBe(200);
    expect(saved.body.narrative.images).toHaveLength(4); // the narrative save never touches the pictures

    const keep = await upload(editToken, docx, "again.docx", false);
    expect(keep.status).toBe(200);
    expect(keep.body.report.narrative.ncrNotes).toBe("Typed by hand");
    expect(keep.body.report.narrative.emailIssuesNotes).toBe("Typed email note");
    expect(keep.body.report.narrative.ncrTableRows[0].description).toBe("EDITED BY HAND");
    const keptIds = keep.body.report.narrative.images.map((image: { attachmentId: number }) => image.attachmentId).sort();
    expect(keptIds).toEqual(original.images.map((image: { attachmentId: number }) => image.attachmentId).sort()); // duplicates skipped by sha256

    const replace = await upload(editToken, docx, "replace.docx", true);
    expect(replace.status).toBe(200);
    expect(replace.body.report.narrative.ncrNotes).toContain("Total September NCRs Logged: 2");
    expect(replace.body.report.narrative.ncrTableRows[0].description).toBe("P3 Slightly out of spec");
    const newIds = replace.body.report.narrative.images.map((image: { attachmentId: number }) => image.attachmentId);
    expect(newIds).toHaveLength(4);
    expect(newIds.some((id: number) => keptIds.includes(id))).toBe(false);
    const row = await reportRow(UPLOAD_MONTH);
    expect((await imageRows(row!.id)).map((r) => r.id).sort()).toEqual([...newIds].sort()); // the old rows are gone
  });

  it("audit-logs NCR row and notes saves, caption edits and picture deletes", async () => {
    const got = await request(app).get("/reports/engineering").query({ year: YEAR, month: UPLOAD_MONTH }).set(bearer(editToken));
    const narrative = got.body.narrative;
    const row = await reportRow(UPLOAD_MONTH);

    const save = await request(app)
      .put("/reports/engineering")
      .set(bearer(editToken))
      .send({ year: YEAR, month: UPLOAD_MONTH, narrative: { ...narrative, ncrNotes: "Changed notes", ncrTableRows: [...narrative.ncrTableRows, { ncrNumber: "NCR-X", partNumber: "P", description: "D", disposition: "S", status: "Open" }] } });
    expect(save.status).toBe(200);
    expect(save.body.narrative.ncrTableRows).toHaveLength(3);

    const imageId = narrative.images[0].attachmentId;
    const caption = await request(app).patch(`/reports/engineering/images/${imageId}`).set(bearer(editToken)).send({ year: YEAR, month: UPLOAD_MONTH, caption: "Claims by week" });
    expect(caption.status).toBe(200);
    expect(caption.body.narrative.images.find((image: { attachmentId: number }) => image.attachmentId === imageId).caption).toBe("Claims by week");
    expect((await request(app).patch(`/reports/engineering/images/${imageId}`).set(bearer(noAccessToken)).send({ year: YEAR, month: UPLOAD_MONTH, caption: "nope" })).status).toBe(403);

    const removed = await request(app).delete(`/reports/engineering/images/${imageId}`).query({ year: YEAR, month: UPLOAD_MONTH }).set(bearer(editToken));
    expect(removed.status).toBe(200);
    expect(removed.body.narrative.images).toHaveLength(3);
    expect((await imageRows(row!.id)).some((r) => r.id === imageId)).toBe(false);
    expect((await request(app).delete(`/reports/engineering/images/${narrative.images[1].attachmentId}`).query({ year: YEAR, month: UPLOAD_MONTH }).set(bearer(noAccessToken))).status).toBe(403);

    const entries = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "QualityEngineeringReport"), eq(auditTrail.entityId, row!.id)));
    const summaries = entries.map((e) => String((e.changes as { summary?: string }).summary ?? ""));
    expect(summaries.some((s) => s.includes("NCR table (from report): 1 row added") && s.includes("NCRs / CARs / PIRs / RPNs notes"))).toBe(true);
    expect(summaries.some((s) => s.includes("changed the caption of picture") && s.includes("Claims by week"))).toBe(true);
    expect(summaries.some((s) => s.includes("removed picture"))).toBe(true);
    expect(summaries.every((s) => !/\b\d{5,}\b/.test(s))).toBe(true);
  });
});

describe("Import from file (the form-import path)", () => {
  it("fills the same fields and stores the pictures when the file is sent with the confirm", async () => {
    const ncrBefore = (await db.select({ id: ncr.id }).from(ncr)).length;
    const extractRes = await request(app).post("/form-import/extract").set(bearer(editToken)).attach("file", docx, "september-import.docx");
    expect(extractRes.status).toBe(200);
    expect(extractRes.body.extracted.imageMeta).toHaveLength(4);
    expect(extractRes.body.imagePreviews).toHaveLength(4);
    expect(extractRes.body.imagePreviews[0].dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(extractRes.body.extracted)).not.toContain('"bytes"');

    const propose = await request(app).post("/form-import/propose").set(bearer(editToken)).send({ targetRef: "report:monthly-quality", extracted: extractRes.body.extracted });
    expect(propose.status).toBe(200);
    for (const pattern of OLD_WARNINGS) expect((propose.body.warnings as string[]).some((warning) => pattern.test(warning))).toBe(false);
    const values = Object.fromEntries(propose.body.proposals.map((p: { key: string; value: unknown }) => [p.key, p.value]));

    const payload = JSON.stringify({ targetRef: "report:monthly-quality", fileName: "september-import.docx", year: YEAR, month: IMPORT_MONTH, replaceNotes: true, values, edited: 0 });
    const denied = await request(app).post("/form-import/confirm").set(bearer(noAccessToken)).field("payload", payload).attach("file", docx, "september-import.docx");
    expect(denied.status).toBe(403);
    const confirm = await request(app).post("/form-import/confirm").set(bearer(editToken)).field("payload", payload).attach("file", docx, "september-import.docx");
    expect(confirm.status).toBe(201);

    const got = await request(app).get("/reports/engineering").query({ year: YEAR, month: IMPORT_MONTH }).set(bearer(editToken));
    expect(got.body.narrative.ncrTableRows).toHaveLength(2);
    expect(got.body.narrative.ncrNotes).toContain("Total September NCRs Logged: 2");
    expect(got.body.narrative.images).toHaveLength(4);
    const row = await reportRow(IMPORT_MONTH);
    expect(await imageRows(row!.id)).toHaveLength(4);
    expect((await db.select({ id: ncr.id }).from(ncr)).length).toBe(ncrBefore);

    const entries = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "QualityEngineeringReport"), eq(auditTrail.entityId, row!.id)));
    const summary = String((entries.pop()!.changes as { summary: string }).summary);
    expect(summary).toContain("2 NCR rows");
    expect(summary).toContain("4 images");
    expect(summary).toContain("October 2026 Monthly Quality Report");
  });

  it("still confirms with a plain JSON body and no file (no pictures stored)", async () => {
    await cleanMonth(IMPORT_MONTH);
    const extractRes = await request(app).post("/form-import/extract").set(bearer(editToken)).attach("file", docx, "x.docx");
    const propose = await request(app).post("/form-import/propose").set(bearer(editToken)).send({ targetRef: "report:monthly-quality", extracted: extractRes.body.extracted });
    const values = Object.fromEntries(propose.body.proposals.map((p: { key: string; value: unknown }) => [p.key, p.value]));
    const confirm = await request(app).post("/form-import/confirm").set(bearer(editToken)).send({ targetRef: "report:monthly-quality", fileName: "x.docx", year: YEAR, month: IMPORT_MONTH, replaceNotes: true, values });
    expect(confirm.status).toBe(201);
    const got = await request(app).get("/reports/engineering").query({ year: YEAR, month: IMPORT_MONTH }).set(bearer(editToken));
    expect(got.body.narrative.ncrTableRows).toHaveLength(2);
    expect(got.body.narrative.images).toHaveLength(0);
  });
});

describe("the report PDF", () => {
  it("shows the NCR numbers and notes and embeds every picture", async () => {
    await cleanMonth(UPLOAD_MONTH);
    const res = await upload(editToken, docx, "pdf-source.docx", true);
    expect(res.status).toBe(200);
    const view = res.body.report;
    const row = await reportRow(UPLOAD_MONTH);
    const files = await loadReportImageFiles(db, row!.id, view.narrative.images);
    expect(files).toHaveLength(4);

    const bytes = await renderEngineeringReportPdf(view, null, files);
    const text = await pdfDrawnText(bytes);
    expect(text).toContain("NCR-2026-065");
    expect(text).toContain("NCR-2026-066");
    expect(text).toContain("[Unassigned]");
    expect(text).toContain("Total September NCRs Logged: 2");
    // The page title already carries the company logo, so the pictures are what the baseline lacks.
    const none = await renderEngineeringReportPdf({ ...view, narrative: { ...view.narrative, images: [] } }, null, []);
    expect((await pdfImageCount(bytes)) - (await pdfImageCount(none))).toBe(4);

    const http = await request(app).get("/reports/engineering/pdf").query({ year: YEAR, month: UPLOAD_MONTH }).set(bearer(editToken));
    expect(http.status).toBe(200);
    expect(String(http.headers["content-type"])).toContain("application/pdf");
    expect((await request(app).get("/reports/engineering/pdf").query({ year: YEAR, month: UPLOAD_MONTH }).set(bearer(noAccessToken))).status).toBe(403);
  });
});

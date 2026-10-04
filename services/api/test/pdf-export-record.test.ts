import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import type { FormLayout } from "../src/modules/forms/layouts/types.js";
import { renderFormLayoutAsPdf } from "../src/modules/forms/schema-pdf-renderer.js";
import { emptyFrame, pdfVisibleText, watermarkForStatus, watermarkLines } from "../src/modules/forms/controlledPdf.js";
import { canonicalMarking, markingFromRecord } from "../src/modules/pdf-exports/recordMarking.js";
import { attachmentTarget } from "../src/modules/attachments/attachmentAccess.js";
import { holdTypesFor, retentionDeleteBlocked } from "../src/modules/pdf-exports/legalHold.js";
import { checksumMatchesFile, sha256Of, writeExportFile } from "../src/modules/pdf-exports/pdfExportStore.js";

const layout: FormLayout = {
  formType: "ncr",
  title: "Nonconformance",
  sections: [
    {
      number: "1",
      title: "Record",
      blocks: [{ type: "row", fields: [{ kind: "text", name: "containment", label: "Containment Action" }] }],
    },
  ],
};

async function imageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let images = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of("Subtype"));
    if (subtype instanceof PDFName && subtype.asString() === "/Image") images += 1;
  }
  return images;
}

describe("stored pdf export", () => {
  it("prints a legal-hold watermark only while the record is held", async () => {
    const held = emptyFrame({
      sourceModule: "NCR",
      recordNumber: "NCR-15",
      revision: "B",
      generatedBy: "Shawn",
      status: "draft",
      legalHold: true,
      exportId: "exp_11111111-1111-1111-1111-111111111111",
      verifyUrl: null,
    });
    const open = emptyFrame({ ...held, legalHold: false, verifyUrl: null });
    expect(watermarkLines(held)).toContain("RECORD UNDER LEGAL HOLD");
    expect(watermarkLines(held)).toContain("DRAFT");
    expect(watermarkLines(open)).not.toContain("RECORD UNDER LEGAL HOLD");
    const text = await pdfVisibleText(await renderFormLayoutAsPdf(layout, { containment: "Hold the lot" }, held));
    expect(text).toContain("RECORD UNDER LEGAL HOLD");
    expect(text).toContain("NCR-15");
    const plain = await pdfVisibleText(await renderFormLayoutAsPdf(layout, { containment: "Hold the lot" }, open));
    expect(plain).not.toContain("RECORD UNDER LEGAL HOLD");
    expect(plain).not.toContain("CONFIDENTIAL");
  });

  it("prints confidentiality only from an existing marking", async () => {
    expect(watermarkForStatus("confidential")).toBeNull();
    expect(canonicalMarking("please keep this confidential")).toBeNull();
    expect(markingFromRecord({ description: "CONFIDENTIAL" })).toBeNull();
    expect(markingFromRecord({ tags: ["Customer Confidential"] })).toBe("CUSTOMER CONFIDENTIAL");
    expect(markingFromRecord({ marking: "Confidential" })).toBe("CONFIDENTIAL");
    const marked = emptyFrame({
      sourceModule: "NCR",
      recordNumber: "NCR-2",
      revision: "A",
      generatedBy: "Shawn",
      status: "active",
      marking: "CUSTOMER CONFIDENTIAL",
      verifyUrl: null,
    });
    expect(watermarkLines(marked)).toEqual(["CUSTOMER CONFIDENTIAL"]);
    const text = await pdfVisibleText(await renderFormLayoutAsPdf(layout, { containment: "Tagged" }, marked));
    expect(text).toContain("CUSTOMER CONFIDENTIAL");
    expect(text).not.toContain("RECORD UNDER LEGAL HOLD");
  });

  it("adds a verification QR for the export id", async () => {
    const id = "exp_22222222-2222-2222-2222-222222222222";
    const quiet = emptyFrame({ sourceModule: "NCR", recordNumber: "NCR-3", revision: "A", generatedBy: "Shawn", exportId: id, verifyUrl: null });
    const linked = emptyFrame({ ...quiet, verifyUrl: `http://localhost:5183/verify/${id}` });
    const without = await renderFormLayoutAsPdf(layout, { containment: "No code" }, quiet);
    const withCode = await renderFormLayoutAsPdf(layout, { containment: "No code" }, linked);
    expect(await imageCount(withCode)).toBeGreaterThan(await imageCount(without));
    expect(await pdfVisibleText(withCode)).toContain(id);
  });

  it("stores the bytes and reports when they still match", async () => {
    const id = `exp_${randomUUID()}`;
    const bytes = await renderFormLayoutAsPdf(layout, { containment: "Stored" }, emptyFrame({
      sourceModule: "NCR",
      recordNumber: "NCR-9",
      revision: "A",
      generatedBy: "Shawn",
      exportId: id,
      verifyUrl: null,
    }));
    const stored = await writeExportFile(id, bytes);
    const onDisk = await readFile(stored.filePath);
    expect(Buffer.from(onDisk).equals(Buffer.from(bytes))).toBe(true);
    expect(stored.sha256).toBe(sha256Of(bytes));
    expect(await checksumMatchesFile(stored.filePath, stored.sha256)).toBe(true);
    const dir = await mkdtemp(path.join(tmpdir(), "pdf-export-"));
    const tampered = path.join(dir, "tampered.pdf");
    await writeFile(tampered, Buffer.from("not the export"));
    expect(await checksumMatchesFile(tampered, stored.sha256)).toBe(false);
    await rm(dir, { recursive: true, force: true });
    await rm(stored.filePath, { force: true });
  });

  it("refuses a second write of the same export id", async () => {
    const id = `exp_${randomUUID()}`;
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const stored = await writeExportFile(id, bytes);
    await expect(writeExportFile(id, bytes)).rejects.toThrow(/already stored/);
    await rm(stored.filePath, { force: true });
  });

  it("attaches a form PDF through the parent record the attachment routes already accept", () => {
    expect(attachmentTarget("ncr")).toBe("ncr");
    expect(attachmentTarget("gage_rr")).toBe("calibration");
    expect(attachmentTarget("control_plan")).toBe("ppap");
    expect(attachmentTarget("quality_report")).toBeNull();
    expect(attachmentTarget("pareto_chart")).toBeNull();
    expect(attachmentTarget(null)).toBeNull();
  });

  it("blocks delete and destruction marking while a hold is active", () => {
    expect(holdTypesFor("ncr")).toContain("ncr");
    expect(retentionDeleteBlocked(true, "deleted")).toBe(true);
    expect(retentionDeleteBlocked(true, "archived")).toBe(false);
    expect(retentionDeleteBlocked(false, "deleted")).toBe(false);
  });
});

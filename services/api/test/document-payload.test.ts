import { describe, expect, it } from "vitest";
import { blankDocumentPayload, diffDocumentVersions, diffLines, lettersFor, nextRevisionCode, normalizeDocumentPayload, revisionCodeForNumber, revisionRank, validateDocumentPayload } from "../src/modules/documents/documentPayload.js";
import { detectFileType, isInsideStorage } from "../src/modules/documents/documentVersioning.js";
import { env } from "../src/config/env.js";
import path from "node:path";

const file = (id: number, name: string, sha = `sha-${id}`, size = 100) => ({ id, fileName: name, mimeType: "application/pdf", sizeBytes: size, sha256: sha });
const doc = (over: Record<string, unknown> = {}) => ({ ...blankDocumentPayload(), title: "Calibration procedure", content: "Step one\nStep two", ...over });

describe("revision codes", () => {
  it("letters like a drawing revision: A..Z, then AA, AB", () => {
    expect([1, 2, 26, 27, 28, 52, 53].map(lettersFor)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
    expect(revisionCodeForNumber(3)).toBe("Rev C");
  });

  it("finds the next code, whatever the case or spacing", () => {
    expect(nextRevisionCode("Rev A")).toBe("Rev B");
    expect(nextRevisionCode("rev  z")).toBe("Rev AA");
    expect(nextRevisionCode("Rev AZ")).toBe("Rev BA");
    expect(nextRevisionCode(null)).toBe("Rev A");
    expect(nextRevisionCode("Rev 3")).toBe("Rev A"); // not in the lettered scheme
  });

  it("ranks codes so the highest can be chosen", () => {
    expect(revisionRank("Rev B")).toBeLessThan(revisionRank("Rev AA"));
    expect(revisionRank("Rev 3")).toBe(0);
  });
});

describe("payload validation", () => {
  it("accepts a complete document and warns about the missing effective date", () => {
    const r = validateDocumentPayload(doc());
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain("no_effective");
  });

  it("requires a title, and either content or a file", () => {
    expect(validateDocumentPayload(doc({ title: "  " })).errors.map((e) => e.code)).toContain("no_title");
    expect(validateDocumentPayload(doc({ content: "" })).errors.map((e) => e.code)).toContain("empty");
    expect(validateDocumentPayload(doc({ content: "", attachments: [file(1, "sop.pdf")] })).errors).toEqual([]);
  });

  it("checks the dates and the retention period", () => {
    expect(validateDocumentPayload(doc({ effectiveDate: "not a date" })).errors.map((e) => e.code)).toContain("bad_effective");
    expect(validateDocumentPayload(doc({ effectiveDate: "2026-06-01", expirationDate: "2026-05-01" })).errors.map((e) => e.code)).toContain("expires_before_effective");
    expect(validateDocumentPayload(doc({ retentionPeriodDays: 0 })).errors.map((e) => e.code)).toContain("bad_retention");
    expect(validateDocumentPayload(doc({ retentionPeriodDays: 365, effectiveDate: "2026-06-01", expirationDate: "2027-06-01" })).errors).toEqual([]);
  });

  it("rejects duplicate and malformed links", () => {
    const link = { type: "equipment", id: 4, label: "Caliper" };
    expect(validateDocumentPayload(doc({ links: [link, link] })).errors.map((e) => e.code)).toContain("duplicate_link");
    expect(validateDocumentPayload(doc({ links: [{ type: "nonsense", id: 1, label: "x" }] })).errors.map((e) => e.code)).toContain("bad_link");
  });

  it("tolerates a partial payload (older versions, hand-built calls)", () => {
    const p = normalizeDocumentPayload({ title: "Only a title" });
    expect(p.attachments).toEqual([]);
    expect(p.links).toEqual([]);
    expect(p.revisionCode).toBe("Rev A");
  });
});

describe("line diff", () => {
  it("marks added, removed and unchanged lines", () => {
    const d = diffLines("a\nb\nc", "a\nx\nc\nd");
    expect(d.map((l) => `${l.op}:${l.text}`)).toEqual(["same:a", "del:b", "add:x", "same:c", "add:d"]);
  });

  it("handles empty sides", () => {
    expect(diffLines("", "a\nb").every((l) => l.op === "add")).toBe(true);
    expect(diffLines("a", "").every((l) => l.op === "del")).toBe(true);
    expect(diffLines("same", "same").every((l) => l.op === "same")).toBe(true);
  });
});

describe("document diff", () => {
  it("reports nothing for identical versions", () => {
    expect(diffDocumentVersions(doc(), doc()).entries).toEqual([]);
  });

  it("reports metadata changes with before and after", () => {
    const r = diffDocumentVersions(doc(), doc({ title: "Calibration procedure v2", revisionCode: "Rev B", expirationDate: "2027-01-01" }));
    const by = Object.fromEntries(r.entries.map((e) => [e.key, e]));
    expect(by.title).toMatchObject({ change: "changed", scope: "metadata", from: "Calibration procedure", to: "Calibration procedure v2" });
    expect(by.revisionCode).toMatchObject({ change: "changed" });
    expect(by.expirationDate).toMatchObject({ change: "added", to: "2027-01-01" });
    expect(r.summary).toEqual({ added: 1, removed: 0, changed: 2 });
  });

  it("reports content as a line diff", () => {
    const r = diffDocumentVersions(doc(), doc({ content: "Step one\nStep 2\nStep three" }));
    const content = r.entries.find((e) => e.scope === "content")!;
    expect(content.change).toBe("changed");
    // "Step two" removed; "Step 2" and "Step three" added; "Step one" untouched.
    expect(content.lines!.map((l) => `${l.op}:${l.text}`)).toEqual(["same:Step one", "del:Step two", "add:Step 2", "add:Step three"]);
  });

  it("tells added, removed and replaced files apart", () => {
    const before = doc({ attachments: [file(1, "wiring.pdf", "aaa"), file(2, "old.pdf")] });
    const after = doc({ attachments: [file(3, "wiring.pdf", "bbb", 200), file(4, "new.pdf")] });
    const r = diffDocumentVersions(before, after);
    const by = Object.fromEntries(r.entries.filter((e) => e.scope === "attachment").map((e) => [e.label, e.change]));
    expect(by).toEqual({ "wiring.pdf": "changed", "old.pdf": "removed", "new.pdf": "added" });
  });

  it("does not call a file that was carried over unchanged a change", () => {
    const same = [file(1, "wiring.pdf", "aaa")];
    expect(diffDocumentVersions(doc({ attachments: same }), doc({ attachments: same })).entries).toEqual([]);
  });

  it("reports links added and removed", () => {
    const eq1 = { type: "equipment", id: 1, label: "Caliper" };
    const sup = { type: "supplier", id: 2, label: "Acme" };
    const r = diffDocumentVersions(doc({ links: [eq1] }), doc({ links: [sup] }));
    expect(r.entries.filter((e) => e.scope === "link").map((e) => `${e.change}:${e.key}`).sort()).toEqual(["added:supplier:2", "removed:equipment:1"]);
  });
});

describe("file acceptance", () => {
  const pdf = Buffer.from("%PDF-1.7\n...");
  const png = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\u001a\n")]);
  const zipWith = (inner: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`....${inner}....`)]);

  it("accepts PDF, images, DOCX and XLSX whose contents match their name", () => {
    expect(detectFileType(pdf, "SOP.PDF")?.mime).toBe("application/pdf");
    expect(detectFileType(png, "diagram.png")?.mime).toBe("image/png");
    expect(detectFileType(zipWith("word/document.xml"), "proc.docx")?.ext).toBe(".docx");
    expect(detectFileType(zipWith("xl/workbook.xml"), "log.xlsx")?.ext).toBe(".xlsx");
  });

  it("refuses a file that is not what its name says, and file kinds that are not allowed", () => {
    expect(detectFileType(Buffer.from("MZ\u0090\u0000 executable"), "sop.pdf")).toBeNull(); // an .exe renamed
    expect(detectFileType(pdf, "sop.docx")).toBeNull(); // PDF bytes, wrong name
    expect(detectFileType(zipWith("anything"), "bundle.zip")).toBeNull();
    expect(detectFileType(zipWith("word/x"), "macro.xlsx")).toBeNull(); // a Word zip called .xlsx
    expect(detectFileType(Buffer.from("<script>alert(1)</script>"), "page.html")).toBeNull();
  });
});

describe("storage boundary", () => {
  it("only trusts paths inside the storage folder", () => {
    const own = path.join(env.STORAGE_LOCAL_PATH, "documents", "1", "a.pdf");
    expect(isInsideStorage(own)).toBe(true);
    expect(isInsideStorage(path.join(env.STORAGE_LOCAL_PATH, "..", "elsewhere", "x.pdf"))).toBe(false); // outside the storage folder
    expect(isInsideStorage(path.join(env.STORAGE_LOCAL_PATH, "documents", "..", "..", "x.pdf"))).toBe(false); // traversal
    expect(isInsideStorage("/etc/passwd")).toBe(false);
    expect(isInsideStorage(`${path.resolve(env.STORAGE_LOCAL_PATH)}-evil/x.pdf`)).toBe(false); // prefix trick
  });
});

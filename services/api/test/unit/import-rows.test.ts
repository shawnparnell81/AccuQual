import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { env } from "../../src/config/env.js";
import { classifyImportRow } from "../../src/modules/import/import.classify.js";
import { IMPORT_ENTITIES } from "../../src/modules/import/import.entities.js";
import { scanSpreadsheet } from "../../src/modules/import/import.scan.js";
import { QUALITY_IMPORT_ENTITIES } from "../../src/modules/import/import.quality.js";

async function importFile(name: string): Promise<{ dir: string; file: string }> {
  await mkdir(env.STORAGE_LOCAL_PATH, { recursive: true });
  const dir = await mkdtemp(path.join(env.STORAGE_LOCAL_PATH, "import-test-"));
  return { dir, file: path.join(dir, name) };
}

describe("import rows", () => {
  it("reads a CSV in order, including a quoted comma", async () => {
    const { dir, file } = await importFile("suppliers.csv");
    try {
      await writeFile(file, 'Supplier name,Contact email\n"Acme, Inc",a@b.com\nBolt Co,\n');
      const rows: string[][] = [];
      const scanned = await scanSpreadsheet(file, "suppliers.csv", async (row) => {
        rows.push(row.cells);
      });
      expect(scanned.headers).toEqual(["Supplier name", "Contact email"]);
      expect(scanned.totalRows).toBe(2);
      expect(rows[0]).toEqual(["Acme, Inc", "a@b.com"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a spreadsheet that is not inside storage", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "import-"));
    try {
      const file = path.join(dir, "suppliers.csv");
      await writeFile(file, "Supplier name\nAcme\n");
      await expect(scanSpreadsheet(file, "suppliers.csv", async () => undefined)).rejects.toThrow(/couldn't be read/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads a legacy .xls workbook", async () => {
    const { dir, file } = await importFile("suppliers.xls");
    try {
      const book = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet([
        ["Supplier name", "Contact email"],
        ["Acme", "a@b.com"],
      ]);
      XLSX.utils.book_append_sheet(book, sheet, "Suppliers");
      const bytes = XLSX.write(book, { bookType: "biff8", type: "buffer" }) as Uint8Array;
      await writeFile(file, Buffer.from(bytes));

      const rows: string[][] = [];
      const scanned = await scanSpreadsheet(file, "suppliers.xls", async (row) => {
        rows.push(row.cells);
      });
      expect(scanned.headers).toEqual(["Supplier name", "Contact email"]);
      expect(scanned.totalRows).toBe(1);
      expect(rows[0]?.slice(0, 2)).toEqual(["Acme", "a@b.com"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("validates supplier rows and classifies duplicates for skip, update, and create-only", () => {
    const entity = IMPORT_ENTITIES.suppliers;
    const lookups = { existing: new Set(["acme fasteners"]), ids: new Map([["acme fasteners", 4]]) };
    const bad = entity.validate({ name: "", contactEmail: "nope" }, lookups);
    expect(bad.errors.join(" ")).toMatch(/required/i);
    expect(bad.errors.join(" ")).toMatch(/email/i);

    const good = entity.validate({ name: "New Co", contactEmail: "ok@x.com" }, lookups);
    expect(good.errors).toEqual([]);
    expect(good.identity).toBe("new co");

    const seen = new Map<string, number>();
    expect(classifyImportRow({ rowNumber: 2, label: "Acme Fasteners", identity: "acme fasteners", fieldErrors: [], existing: lookups.existing, seen, duplicateMode: "skip" }).action).toBe("skip");
    seen.clear();
    expect(classifyImportRow({ rowNumber: 2, label: "Acme Fasteners", identity: "acme fasteners", fieldErrors: [], existing: lookups.existing, seen, duplicateMode: "update" }).action).toBe("update");
    seen.clear();
    const createdOnly = classifyImportRow({ rowNumber: 2, label: "Acme Fasteners", identity: "acme fasteners", fieldErrors: [], existing: lookups.existing, seen, duplicateMode: "create_only" });
    expect(createdOnly.action).toBe("invalid");
    expect(createdOnly.messages.join(" ")).toMatch(/already exists/i);

    seen.clear();
    classifyImportRow({ rowNumber: 2, label: "New Co", identity: "new co", fieldErrors: [], existing: lookups.existing, seen, duplicateMode: "skip" });
    const repeat = classifyImportRow({ rowNumber: 5, label: "New Co", identity: "new co", fieldErrors: [], existing: lookups.existing, seen, duplicateMode: "skip" });
    expect(repeat.messages.join(" ")).toMatch(/more than once/);
  });

  it("rejects a customer contact with a bad email and an inspection result with a bad date", () => {
    const customers = QUALITY_IMPORT_ENTITIES.customers;
    const contact = customers.validate({ legalName: "Northwind", primaryContactEmail: "not-an-email", primaryContactName: "", primaryContactPhone: "" }, { existing: new Set(), ids: new Map() });
    expect(contact.errors.join(" ")).toMatch(/email/i);

    const inspections = QUALITY_IMPORT_ENTITIES.inspection_results;
    const row = inspections.validate(
      { partMaterialNo: "FST-1", batchLotNo: "L1", inspectionDate: "March", parameter: "Length", specification: "", actualFinding: "", result: "pass", measurementUnit: "", specMin: "", specMax: "", actualValue: "10" },
      { existing: new Set(), ids: new Map(), reportIds: new Map() }
    );
    expect(row.errors.join(" ")).toMatch(/date/i);
    const ok = inspections.validate(
      { partMaterialNo: "FST-1", batchLotNo: "L1", inspectionDate: "2026-03-01", parameter: "Length", specification: "", actualFinding: "", result: "passed", measurementUnit: "mm", specMin: "", specMax: "", actualValue: "10" },
      { existing: new Set(), ids: new Map(), reportIds: new Map() }
    );
    expect(ok.errors).toEqual([]);
    expect(ok.identity).toContain("fst-1");
  });
});

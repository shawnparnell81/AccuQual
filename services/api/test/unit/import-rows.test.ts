import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyImportRow } from "../../src/modules/import/import.classify.js";
import { IMPORT_ENTITIES } from "../../src/modules/import/import.entities.js";
import { scanSpreadsheet } from "../../src/modules/import/import.scan.js";
import { QUALITY_IMPORT_ENTITIES } from "../../src/modules/import/import.quality.js";

describe("import rows", () => {
  it("reads a CSV in order, including a quoted comma", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "import-"));
    const file = path.join(dir, "suppliers.csv");
    await writeFile(file, 'Supplier name,Contact email\n"Acme, Inc",a@b.com\nBolt Co,\n');
    const rows: string[][] = [];
    const scanned = await scanSpreadsheet(file, "suppliers.csv", async (row) => {
      rows.push(row.cells);
    });
    expect(scanned.headers).toEqual(["Supplier name", "Contact email"]);
    expect(scanned.totalRows).toBe(2);
    expect(rows[0]).toEqual(["Acme, Inc", "a@b.com"]);
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

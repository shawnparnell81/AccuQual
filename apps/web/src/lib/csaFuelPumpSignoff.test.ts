import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CSA_SIGNATURES, buildSheetRows } from "./validationReportSheet";
import { FUEL_PUMP_SIGNATURES, buildFuelPumpRows } from "./fuelPumpSheet";

const api = readFileSync(new URL("../../../../services/api/src/modules/validation-reports/validation-reports.controller.ts", import.meta.url), "utf8");

describe("CSA and Fuel Pump PIN sign-off", () => {
  it("sign-off cells are existing cells of each sheet (layout unchanged)", () => {
    const csa = new Set(buildSheetRows().flat().map((cell) => cell.addr));
    for (const slot of CSA_SIGNATURES) assert.ok(csa.has(slot.addr), slot.addr);
    const fp = new Set(buildFuelPumpRows().flat().map((cell) => cell.addr));
    for (const slot of FUEL_PUMP_SIGNATURES) assert.ok(fp.has(slot.addr), slot.addr);
  });
  it("the server accepts each signature with the same wording", () => {
    for (const slot of [...CSA_SIGNATURES, ...FUEL_PUMP_SIGNATURES]) assert.ok(api.includes(slot.certify), slot.addr);
  });
  it("both sheets draw the shared PIN signature block in those cells, and the page signs through the server", () => {
    for (const file of ["ValidationReportSheet.tsx", "FuelPumpSheet.tsx"]) {
      const src = readFileSync(new URL(`../routes/ValidationReports/${file}`, import.meta.url), "utf8");
      assert.match(src, /<SignatureStamp/, file);
    }
    const page = readFileSync(new URL("../routes/ValidationReports/ValidationReportDetailPage.tsx", import.meta.url), "utf8");
    assert.equal((page.match(/furtherSignature: furtherSignatureOf\(report\.data\)/g) ?? []).length, 2);
  });
});

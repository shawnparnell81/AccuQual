import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { capaLayout } from "../src/modules/forms/layouts/capa.js";
import { controlPlanLayout } from "../src/modules/forms/layouts/controlPlan.js";
import { fmeaLayout } from "../src/modules/forms/layouts/fmea.js";
import { lpaLayout } from "../src/modules/forms/layouts/lpa.js";
import { ncrLayout } from "../src/modules/forms/layouts/ncr.js";
import { renderFormLayoutAsPdf } from "../src/modules/forms/schema-pdf-renderer.js";

async function pageSize(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  return { width: page.getWidth(), height: page.getHeight() };
}

describe("printable form page size", () => {
  it("keeps NCR and CAPA on a portrait letter page", async () => {
    const ncr = await pageSize(await renderFormLayoutAsPdf(ncrLayout, {}));
    const capa = await pageSize(await renderFormLayoutAsPdf(capaLayout, {}));
    expect(ncr).toEqual({ width: 612, height: 792 });
    expect(capa).toEqual({ width: 612, height: 792 });
  });

  it("turns wide workbook tables onto landscape letter", async () => {
    const fmea = await pageSize(await renderFormLayoutAsPdf(fmeaLayout, {}));
    const controlPlan = await pageSize(await renderFormLayoutAsPdf(controlPlanLayout, {}));
    const lpa = await pageSize(await renderFormLayoutAsPdf(lpaLayout, {}));
    expect(fmea).toEqual({ width: 792, height: 612 });
    expect(controlPlan).toEqual({ width: 792, height: 612 });
    expect(lpa).toEqual({ width: 792, height: 612 });
  });
});

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { vehicleApplication, type FpmState } from "./fuelPumpFai.logic.js";

/** Final fuel-pump first-article report. Generated at release and kept in the archive. */
export async function renderFuelPumpPdf(state: FpmState): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  let y = 750;
  const draw = (text: string, size = 11, useBold = false) => {
    for (const line of text.split("\n")) {
      if (y < 48) {
        page = doc.addPage([612, 792]);
        y = 750;
      }
      page.drawText(line.slice(0, 110), { x: 48, y, size, font: useBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 6;
    }
  };
  draw("Fuel Pump Module — First Article Inspection", 16, true);
  draw(state.outcomeDisplay ?? state.status, 12, true);
  draw(`${state.number} · ${state.productFamily}`);
  draw(`Part ${state.partNumber} — ${state.partDescription}`);
  draw(`Supplier ${state.supplier} · ${state.supplierPartNumber} · lot ${state.sampleLotNumber}`);
  draw(`Vehicle ${vehicleApplication(state)}`);
  draw(`Inspector ${state.inspector} · validation ${state.validationOwner || "—"} · opened ${state.dateOpened.slice(0, 10)}`);
  draw(`Status ${state.status} · stage ${state.stage} · production release ${state.productionRelease}`);
  draw(`Flow ${state.flowRateResult ?? "—"} · pressure ${state.pressureResult ?? "—"} · current draw ${state.currentDrawResult ?? "—"}`);
  draw(`Electrical ${state.electricalResult ?? "—"} · fitment ${state.fitmentResult ?? "—"} · packaging ${state.packagingResult ?? "—"}`);
  if (state.ncrId) draw(`Linked NCR ${state.ncrId} · NCR required ${state.ncrRequired}`);
  for (const attempt of [...state.history, state.attempt]) {
    draw(`Attempt ${attempt.number} · ${attempt.overall ?? "in progress"}`, 13, true);
    if (attempt.totals) draw(`Criteria ${attempt.totals.criteria}, passed ${attempt.totals.passed}, failed ${attempt.totals.failed}, engineering review ${attempt.totals.engineeringReviewRequired}`);
    for (const row of attempt.results) {
      const actual = row.actual ? ` actual ${row.actual}${row.units ? ` ${row.units}` : ""}` : "";
      const limits = row.specifiedLimits ? ` limits ${row.specifiedLimits}` : "";
      draw(`${row.label}: ${row.result}${actual}${limits}`);
    }
  }
  if (state.correctiveAction) {
    draw("Corrective action", 13, true);
    draw(`${state.correctiveAction.correctiveAction} · ${state.correctiveAction.responsiblePerson} · due ${state.correctiveAction.dueDate}`);
  }
  return doc.save();
}

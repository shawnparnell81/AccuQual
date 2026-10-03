import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { vehicleApplication, type CsaState } from "./csaFai.logic.js";

/** Final CSA first-article report. Generated at release and kept in the archive. */
export async function renderCsaPdf(state: CsaState): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  let y = 750;
  const draw = (text: string, size = 11, useBold = false) => {
    const lines = text.split("\n");
    for (const line of lines) {
      if (y < 48) {
        page = doc.addPage([612, 792]);
        y = 750;
      }
      page.drawText(line.slice(0, 110), { x: 48, y, size, font: useBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 6;
    }
  };
  draw("Complete Strut Assembly — First Article Inspection", 16, true);
  draw(state.outcomeDisplay ?? state.status, 12, true);
  draw(`${state.number} · ${state.productFamily}`);
  draw(`Part ${state.partNumber} — ${state.partDescription}`);
  draw(`Supplier ${state.supplierName} · ${state.supplierPartNumber} · lot ${state.sampleLotNumber}`);
  draw(`Vehicle ${vehicleApplication(state)}`);
  draw(`Inspector ${state.inspectorName} · opened ${state.dateOpened.slice(0, 10)}`);
  draw(`Status ${state.status} · stage ${state.stage} · production release ${state.productionRelease} · approved supplier ${state.approvedSupplier}`);
  if (state.ncrId) draw(`Linked NCR ${state.ncrId} · NCR required ${state.ncrRequired}`);
  const attempts = [...state.history, state.attempt];
  for (const attempt of attempts) {
    draw(`Attempt ${attempt.number} · ${attempt.overall ?? "in progress"}`, 13, true);
    if (attempt.totals) draw(`Criteria ${attempt.totals.criteria}, passed ${attempt.totals.passed}, failed ${attempt.totals.failed}, N/A ${attempt.totals.notApplicable}, engineering review ${attempt.totals.engineeringReviewRequired}`);
    for (const row of attempt.results) {
      const actual = row.actual ? ` actual ${row.actual}${row.units ? ` ${row.units}` : ""}` : "";
      const limits = row.specifiedLimits ? ` limits ${row.specifiedLimits}` : "";
      draw(`${row.label}: ${row.result}${actual}${limits}`);
    }
  }
  if (state.correctiveAction) {
    draw("Corrective action", 13, true);
    draw(`${state.correctiveAction.correctiveAction} · owner ${state.correctiveAction.owner} · due ${state.correctiveAction.dueDate} · sample ${state.correctiveAction.correctedSampleId}`);
  }
  return doc.save();
}

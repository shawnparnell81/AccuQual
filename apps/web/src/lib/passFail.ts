/**
 * Shared tolerance check for every measured grid.
 * Implementation: services/api/src/utils/passFail.ts (screen and PDF use one function).
 * Policy: docs/development/new-modules-design-notes.md — "Pass/Fail is calculated".
 */
export {
  FAIL_FILL,
  FAIL_INK,
  PASS_FILL,
  PASS_INK,
  applyMeasuredResult,
  faiFill,
  faiResult,
  hydrateDimensionalRow,
  inspectionItemResult,
  measuredCellValue,
  parseMeasure,
  passFailFill,
  passFailPaint,
  passFailPdfPalette,
  rowPassFail,
  splitSpecification,
  toleranceBand,
} from "../../../../services/api/src/utils/passFail";
export type { MeasuredKeys, PassFailFill, PassFailWord } from "../../../../services/api/src/utils/passFail";

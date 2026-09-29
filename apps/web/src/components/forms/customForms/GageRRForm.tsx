import { useEffect, useMemo } from "react";
import { sheetRevision } from "../../../lib/formDocument";
import { computeGageRR, gageEvaluationFill, PART_COUNT } from "./gageRRMath";
import "../../../routes/IsoForms/isoForm.css";

interface CustomFormProps {
  data: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  documentNumber?: string;
}

const PARTS = Array.from({ length: PART_COUNT }, (_, i) => i + 1);
function numArray(v: unknown): number[] {
  const arr = Array.isArray(v) ? v : [];
  return PARTS.map((_, i) => (typeof arr[i] === "number" ? (arr[i] as number) : 0));
}

function fmt(n: number, digits = 3): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

/**
 * Gage R&R (Average and Range method), derived 1:1 from the source
 * "MSA Gauge R_R.pdf" — a full spreadsheet-style calculation (per-column
 * means/ranges across a 10-part x 2-operator x 2-trial grid, then several
 * study-wide derived values) that doesn't fit the row-by-row computed-column
 * model the rest of the forms engine uses, so it's a bespoke component
 * instead of a layouts/*.ts schema. See customForms/gageRRMath.ts for the
 * formulas — checked value-for-value against the source document's own
 * worked example. Registered in customForms/index.ts; FormEditor renders it
 * when no layout exists for the form type. A plain export-only FormLayout
 * (services/api's layouts/gageRR.ts) prints the final computed values on PDF
 * export, since that path doesn't run this component.
 */
export function GageRRForm({ data, onChange, documentNumber = "" }: CustomFormProps) {
  // Memoized on the actual stored reference (not recreated every render) so
  // the sync effect below only re-fires when the underlying data really
  // changes, not on every render.
  const aTrial1 = useMemo(() => numArray(data.aTrial1), [data.aTrial1]);
  const aTrial2 = useMemo(() => numArray(data.aTrial2), [data.aTrial2]);
  const bTrial1 = useMemo(() => numArray(data.bTrial1), [data.bTrial1]);
  const bTrial2 = useMemo(() => numArray(data.bTrial2), [data.bTrial2]);
  const tolerance = typeof data.tolerance === "number" ? data.tolerance : 0;

  const result = useMemo(() => computeGageRR(aTrial1, aTrial2, bTrial1, bTrial2, tolerance), [aTrial1, aTrial2, bTrial1, bTrial2, tolerance]);

  // Keep the derived summary values in `data` so PDF export (which can't run
  // this component) still prints real numbers, not blanks — but only write
  // a field when its value actually changed, or this would re-render forever
  // (every onChange call updates the parent's `data`, which would otherwise
  // re-trigger this same effect on every pass).
  useEffect(() => {
    const summary: Record<string, unknown> = {
      rBar: result.rBar,
      xBarDiff: result.xBarDiff,
      uclR: result.uclR,
      ev: result.ev,
      evPctTol: result.evPctTol,
      av: result.av,
      avPctTol: result.avPctTol,
      pv: result.pv,
      pvPctTol: result.pvPctTol,
      grr: result.grr,
      grrPctTol: result.grrPctTol,
      systemEvaluation: result.systemEvaluation,
    };
    for (const [key, value] of Object.entries(summary)) {
      if (data[key] !== value) onChange(key, value);
    }
    // Intentionally keyed on `result` alone (not `data`/`onChange`) — see the comment above.
  }, [result]);

  function updateCell(field: "aTrial1" | "aTrial2" | "bTrial1" | "bTrial2", index: number, value: number) {
    const current = field === "aTrial1" ? aTrial1 : field === "aTrial2" ? aTrial2 : field === "bTrial1" ? bTrial1 : bTrial2;
    const next = current.map((v, i) => (i === index ? value : v));
    onChange(field, next);
  }

  function field(label: string, name: string, type: "text" | "number" | "date" = "text") {
    return (
      <input
        className="iso-in"
        type={type}
        aria-label={label}
        value={(data[name] as string | number) ?? ""}
        onChange={(event) => onChange(name, type === "number" ? event.target.valueAsNumber : event.target.value)}
      />
    );
  }

  function measurementRow(label: string, fieldName: "aTrial1" | "aTrial2" | "bTrial1" | "bTrial2", values: number[]) {
    return (
      <tr>
        <td>{label}</td>
        {values.map((value, index) => (
          <td key={index}>
            <input className="iso-in center" type="number" aria-label={`${label} part ${index + 1}`} value={value || ""} onChange={(event) => updateCell(fieldName, index, event.target.valueAsNumber || 0)} />
          </td>
        ))}
        <td className="center">{fmt(values.reduce((sum, value) => sum + value, 0) / (values.length || 1), 3)}</td>
      </tr>
    );
  }

  function derivedRow(label: string, values: number[], average: number) {
    return (
      <tr>
        <td>{label}</td>
        {values.map((value, index) => (
          <td key={index} className="center">
            {fmt(value, 2)}
          </td>
        ))}
        <td className="center">{fmt(average, 3)}</td>
      </tr>
    );
  }

  const evaluation = result.systemEvaluation;
  const pct = (value: number | null, digits: number) => (value == null ? "—" : `${fmt(value, digits)}%`);

  return (
    <div className="iso-wrap aq-form-copy aq-print-sheet min-w-0">
      <table className="iso" data-testid="gage-rr-sheet" aria-label="Gage R&R">
        <tbody>
          <tr>
            <td className="title" colSpan={PART_COUNT + 2}>
              GAGE R&amp;R
            </td>
          </tr>
          <tr>
            <td colSpan={4}>{sheetRevision(documentNumber)}</td>
            <td colSpan={PART_COUNT - 2}>Average and range method · D4 = 3.27 · K1 = 0.8862 · K2 = 0.7071 · K3 = 0.3146</td>
          </tr>
          <tr>
            <td>Device number</td>
            <td colSpan={3}>{field("Device number", "deviceNumber")}</td>
            <td>Part number</td>
            <td colSpan={3}>{field("Part number", "partNumber")}</td>
            <td>Characteristic</td>
            <td colSpan={2}>{field("Characteristic", "characteristic")}</td>
            <td>{field("Unit", "unit")}</td>
          </tr>
          <tr>
            <td>Operator A</td>
            <td colSpan={3}>{field("Operator A", "operatorAName")}</td>
            <td>Operator B</td>
            <td colSpan={3}>{field("Operator B", "operatorBName")}</td>
            <td>Tolerance</td>
            <td>{field("Tolerance", "tolerance", "number")}</td>
            <td>Date</td>
            <td>{field("Study date", "studyDate", "date")}</td>
          </tr>
          <tr>
            <td className="section" colSpan={PART_COUNT + 2}>
              MEASUREMENTS
            </td>
          </tr>
          <tr>
            <td className="header">Part</td>
            {PARTS.map((part) => (
              <td key={part} className="header">
                {part}
              </td>
            ))}
            <td className="header">Average</td>
          </tr>
          <tr>
            <td className="header" colSpan={PART_COUNT + 2}>
              Operator A
            </td>
          </tr>
          {measurementRow("Trial 1", "aTrial1", aTrial1)}
          {measurementRow("Trial 2", "aTrial2", aTrial2)}
          {derivedRow("Mean X", result.meanA, result.meanA.reduce((sum, value) => sum + value, 0) / PART_COUNT)}
          {derivedRow("Range RA", result.rangeA, result.raBar)}
          <tr>
            <td className="header" colSpan={PART_COUNT + 2}>
              Operator B
            </td>
          </tr>
          {measurementRow("Trial 1", "bTrial1", bTrial1)}
          {measurementRow("Trial 2", "bTrial2", bTrial2)}
          {derivedRow("Mean X", result.meanB, result.meanB.reduce((sum, value) => sum + value, 0) / PART_COUNT)}
          {derivedRow("Range RB", result.rangeB, result.rbBar)}
          {derivedRow("X p (part average)", result.partAvg, result.partAvg.reduce((sum, value) => sum + value, 0) / PART_COUNT)}
          <tr>
            <td className="section" colSpan={PART_COUNT + 2}>
              CALCULATION
            </td>
          </tr>
          <tr>
            <td colSpan={4}>R = (RA + RB) / 2</td>
            <td colSpan={2}>{fmt(result.rBar)}</td>
            <td colSpan={3}>X diff = max mean − min mean</td>
            <td colSpan={3}>{fmt(result.xBarDiff)}</td>
          </tr>
          <tr>
            <td colSpan={4}>UCL R = R × D4</td>
            <td colSpan={2}>{fmt(result.uclR)}</td>
            <td colSpan={3}>Rp = max part average − min part average</td>
            <td colSpan={3}>{fmt(Math.max(...result.partAvg) - Math.min(...result.partAvg))}</td>
          </tr>
          <tr>
            <td colSpan={4}>EV = R × K1</td>
            <td colSpan={2}>{fmt(result.ev, 4)}</td>
            <td colSpan={3}>%EV &amp; Tol = 100 × (EV / Tol)</td>
            <td colSpan={3}>{pct(result.evPctTol, 1)}</td>
          </tr>
          <tr>
            <td colSpan={4}>AV = √[(X diff × K2)² − (EV² / nr)]</td>
            <td colSpan={2}>{fmt(result.av, 4)}</td>
            <td colSpan={3}>%AV &amp; Tol = 100 × (AV / Tol)</td>
            <td colSpan={3}>{pct(result.avPctTol, 1)}</td>
          </tr>
          <tr>
            <td colSpan={4}>PV = Rp × K3</td>
            <td colSpan={2}>{fmt(result.pv, 4)}</td>
            <td colSpan={3}>%PV &amp; Tol = 100 × (PV / Tol)</td>
            <td colSpan={3}>{pct(result.pvPctTol, 1)}</td>
          </tr>
          <tr>
            <td colSpan={4}>GRR = √(EV² + AV²)</td>
            <td colSpan={2}>{fmt(result.grr, 4)}</td>
            <td colSpan={3}>%GRR &amp; Tol = 100 × (GRR / Tol)</td>
            <td colSpan={3}>{pct(result.grrPctTol, 0)}</td>
          </tr>
          <tr>
            <td>System evaluation</td>
            <td className={gageEvaluationFill(evaluation)} colSpan={PART_COUNT - 3} data-testid="gage-evaluation">
              {evaluation || "Enter a tolerance to evaluate the system."}
            </td>
            <td>Approval date</td>
            <td>{field("Approval date", "approvalDate", "date")}</td>
            <td>Signature</td>
            <td>{field("Approval signature", "approvalSignature")}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

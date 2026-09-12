import { useEffect, useMemo } from "react";
import { computeGageRR, PART_COUNT } from "./gageRRMath";

interface CustomFormProps {
  data: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}

const PARTS = Array.from({ length: PART_COUNT }, (_, i) => i + 1);
const INPUT_CLASS = "w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary";

function numArray(v: unknown): number[] {
  const arr = Array.isArray(v) ? v : [];
  return PARTS.map((_, i) => (typeof arr[i] === "number" ? (arr[i] as number) : 0));
}

function fmt(n: number, digits = 3): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

/**
 * Gage R&R (Average and Range method), derived 1:1 from the user-provided
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
export function GageRRForm({ data, onChange }: CustomFormProps) {
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

  function headerField(label: string, name: string, type: "text" | "number" | "date" = "text") {
    return (
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-semibold text-slate-700">{label}</span>
        <input
          type={type}
          className={INPUT_CLASS}
          value={(data[name] as string | number) ?? ""}
          onChange={(e) => onChange(name, type === "number" ? e.target.valueAsNumber : e.target.value)}
        />
      </label>
    );
  }

  function measurementRow(label: string, field: "aTrial1" | "aTrial2" | "bTrial1" | "bTrial2", values: number[]) {
    return (
      <tr>
        <td className="border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium">{label}</td>
        {values.map((v, i) => (
          <td key={i} className="border border-slate-200 p-0.5">
            <input
              type="number"
              className={INPUT_CLASS}
              value={v || ""}
              onChange={(e) => updateCell(field, i, e.target.valueAsNumber || 0)}
            />
          </td>
        ))}
      </tr>
    );
  }

  function derivedRow(label: string, values: number[]) {
    return (
      <tr>
        <td className="border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium">{label}</td>
        {values.map((v, i) => (
          <td key={i} className="border border-slate-200 px-2 py-1 text-xs text-slate-600">
            {fmt(v, 2)}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <div className="flex flex-col gap-5 text-sm">
      <h2 className="text-center text-base font-bold uppercase tracking-wide text-slate-800">Gage R&amp;R (Average and Range Method)</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {headerField("Device Number", "deviceNumber")}
        {headerField("Part Number", "partNumber")}
        {headerField("Characteristic", "characteristic")}
        {headerField("Tolerance", "tolerance", "number")}
        {headerField("Operator A Name", "operatorAName")}
        {headerField("Operator B Name", "operatorBName")}
        {headerField("Study Date", "studyDate", "date")}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border border-slate-200 bg-slate-100 px-2 py-1 text-left">Part #</th>
              {PARTS.map((p) => (
                <th key={p} className="border border-slate-200 bg-slate-100 px-2 py-1">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={PART_COUNT + 1} className="bg-slate-200 px-2 py-1 text-xs font-bold">
                Operator A
              </td>
            </tr>
            {measurementRow("Trial 1", "aTrial1", aTrial1)}
            {measurementRow("Trial 2", "aTrial2", aTrial2)}
            {derivedRow("Mean", result.meanA)}
            {derivedRow("Range", result.rangeA)}
            <tr>
              <td colSpan={PART_COUNT + 1} className="bg-slate-200 px-2 py-1 text-xs font-bold">
                Operator B
              </td>
            </tr>
            {measurementRow("Trial 1", "bTrial1", bTrial1)}
            {measurementRow("Trial 2", "bTrial2", bTrial2)}
            {derivedRow("Mean", result.meanB)}
            {derivedRow("Range", result.rangeB)}
            {derivedRow("Part Average (A & B)", result.partAvg)}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Calculation</h3>
        <div className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          <div>
            R̄ (Rśr) = (R̄A + R̄B) / 2 = <strong>{fmt(result.rBar)}</strong>
          </div>
          <div>
            X̄ Diff = |mean A − mean B| = <strong>{fmt(result.xBarDiff)}</strong>
          </div>
          <div>
            UCL_R = R̄ × D4 (3.27) = <strong>{fmt(result.uclR)}</strong>
          </div>
          <div className="sm:row-span-1" />
          <div>
            EV (Equipment Variation) = R̄ × K1 = <strong>{fmt(result.ev)}</strong>
          </div>
          <div>%EV &amp; Tol = {result.evPctTol === null ? "—" : `${fmt(result.evPctTol, 1)}%`}</div>
          <div>
            AV (Appraiser Variation) = <strong>{fmt(result.av)}</strong>
          </div>
          <div>%AV &amp; Tol = {result.avPctTol === null ? "—" : `${fmt(result.avPctTol, 1)}%`}</div>
          <div>
            PV (Part Variation) = R̄p × K3 = <strong>{fmt(result.pv)}</strong>
          </div>
          <div>%PV &amp; Tol = {result.pvPctTol === null ? "—" : `${fmt(result.pvPctTol, 1)}%`}</div>
          <div className="text-sm font-bold text-slate-900">GRR = √(EV² + AV²) = {fmt(result.grr)}</div>
          <div className="text-sm font-bold text-slate-900">
            %GRR &amp; Tol = {result.grrPctTol === null ? "—" : `${fmt(result.grrPctTol, 1)}%`}
          </div>
        </div>
        <div className="mt-4 rounded-md bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
          System evaluation: {result.systemEvaluation || "Enter a tolerance to evaluate the system."}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {headerField("Approval — Date", "approvalDate", "date")}
        {headerField("Approval — Signature", "approvalSignature")}
      </div>
    </div>
  );
}

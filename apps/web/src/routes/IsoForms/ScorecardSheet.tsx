import { Legend, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import type { CellValue } from "../../lib/isoFormLogic";
import {
  NBH_OPTIONS,
  VOC_OPTIONS,
  blankScorecardRow,
  formatRatio,
  higherBetterFill,
  lowerBetterFill,
  nbhFill,
  parseMeasure,
  scorecardAchievement,
  vocFill,
  type ScorecardRow,
} from "../../lib/qualitySheetLogic";
import "./isoForm.css";

interface ScorecardSheetProps {
  cells: Record<string, CellValue>;
  customers: ScorecardRow[];
  readOnly?: boolean;
  onCell: (addr: string, value: CellValue) => void;
  onCustomers: (customers: ScorecardRow[]) => void;
}

function textOf(value: CellValue | undefined): string {
  return value == null || typeof value === "boolean" ? "" : String(value);
}

function visibleRows(customers: ScorecardRow[]): ScorecardRow[] {
  if (customers.length > 0) return customers;
  return [blankScorecardRow("global"), blankScorecardRow(), blankScorecardRow(), blankScorecardRow(), blankScorecardRow()];
}

function Num({ label, value, readOnly, onChange }: { label: string; value: string; readOnly: boolean; onChange: (value: string) => void }) {
  return <input className="iso-in center" inputMode="decimal" aria-label={label} value={value} disabled={readOnly} onChange={(event) => onChange(event.target.value)} />;
}

export function ScorecardSheet({ cells, customers, readOnly = false, onCell, onCustomers }: ScorecardSheetProps) {
  const rows = visibleRows(customers);

  function edit(index: number, patch: Partial<ScorecardRow>) {
    onCustomers(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  const chartRows = rows
    .filter((row) => row.name.trim())
    .map((row) => ({
      name: row.name.trim(),
      ppm: Math.round((scorecardAchievement(row, "ppm") ?? 0) * 100),
      nct: Math.round((scorecardAchievement(row, "nct") ?? 0) * 100),
      otd: parseMeasure(row.otdYear) ?? 0,
    }));

  return (
    <div className="flex flex-col gap-4">
      <div className="iso-wrap">
        <table className="iso" data-testid="scorecard-sheet" aria-label="Customer Scorecard">
          <tbody>
            <tr>
              <td className="title" colSpan={8}>
                CUSTOMER SCORE CARD
              </td>
            </tr>
            <tr>
              <td>Rev: A</td>
              <td>Month / Year</td>
              <td colSpan={2}>
                <input className="iso-in" aria-label="Month and year" placeholder="April 2021" value={textOf(cells.B2)} disabled={readOnly} onChange={(event) => onCell("B2", event.target.value)} />
              </td>
              <td colSpan={4} className="note">
                Green: no escalation. Yellow: minor escalation. Red: escalation that affects a certification body.
              </td>
            </tr>
            <tr>
              <td className="header" rowSpan={2}>
                Group
              </td>
              <td className="header" rowSpan={2}>
                Customer
              </td>
              <td className="header">VOC</td>
              <td className="header">NBH</td>
              <td className="header" colSpan={2}>
                PPM
              </td>
              <td className="header" colSpan={2}>
                NCTs
              </td>
            </tr>
            <tr>
              <td className="header">R / Y / G</td>
              <td className="header">Y / N</td>
              <td className="header">Month</td>
              <td className="header">YTD / Target / % year</td>
              <td className="header">Month</td>
              <td className="header">YTD / Target / % year</td>
            </tr>
            {rows.map((row, index) => {
              const ppm = scorecardAchievement(row, "ppm");
              const nct = scorecardAchievement(row, "nct");
              const nctMode = row.band === "global" ? "global-nct" : "customer";
              return (
                <tr key={index}>
                  <td>
                    <input className="iso-in" aria-label={`Group ${index + 1}`} value={row.group} disabled={readOnly} onChange={(event) => edit(index, { group: event.target.value })} />
                  </td>
                  <td>
                    <input className="iso-in" aria-label={`Customer ${index + 1}`} value={row.name} disabled={readOnly} onChange={(event) => edit(index, { name: event.target.value })} />
                  </td>
                  <td className={vocFill(row.voc)}>
                    <select className="iso-in" aria-label={`VOC ${index + 1}`} value={row.voc} disabled={readOnly} onChange={(event) => edit(index, { voc: event.target.value })}>
                      {VOC_OPTIONS.map((option) => (
                        <option key={option || "blank"} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={nbhFill(row.nbh)}>
                    <select className="iso-in" aria-label={`NBH ${index + 1}`} value={row.nbh} disabled={readOnly} onChange={(event) => edit(index, { nbh: event.target.value })}>
                      {NBH_OPTIONS.map((option) => (
                        <option key={option || "blank"} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={lowerBetterFill(parseMeasure(row.ppmMonth), parseMeasure(row.ppmTarget))}>
                    <Num label={`PPM month ${index + 1}`} value={row.ppmMonth} readOnly={readOnly} onChange={(value) => edit(index, { ppmMonth: value })} />
                  </td>
                  <td>
                    <div className="flex flex-col gap-1">
                      <Num label={`PPM YTD ${index + 1}`} value={row.ppmYtd} readOnly={readOnly} onChange={(value) => edit(index, { ppmYtd: value })} />
                      <Num label={`PPM target ${index + 1}`} value={row.ppmTarget} readOnly={readOnly} onChange={(value) => edit(index, { ppmTarget: value })} />
                      <div className={lowerBetterFill(parseMeasure(row.ppmYtd), parseMeasure(row.ppmTarget))}>{formatRatio(ppm)}</div>
                    </div>
                  </td>
                  <td className={lowerBetterFill(parseMeasure(row.nctMonth), parseMeasure(row.nctTarget))}>
                    <Num label={`NCT month ${index + 1}`} value={row.nctMonth} readOnly={readOnly} onChange={(value) => edit(index, { nctMonth: value })} />
                  </td>
                  <td>
                    <div className="flex flex-col gap-1">
                      <Num label={`NCT YTD ${index + 1}`} value={row.nctYtd} readOnly={readOnly} onChange={(value) => edit(index, { nctYtd: value })} />
                      <Num label={`NCT target ${index + 1}`} value={row.nctTarget} readOnly={readOnly} onChange={(value) => edit(index, { nctTarget: value })} />
                      <div className={lowerBetterFill(parseMeasure(row.nctYtd), parseMeasure(row.nctTarget))} data-nct-mode={nctMode}>
                        {formatRatio(nct)}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="iso-wrap">
        <table className="iso" aria-label="Delivery, freight, and warranty">
          <tbody>
            <tr>
              <td className="header">Customer</td>
              <td className="header">On-time delivery %</td>
              <td className="header">OTD target %</td>
              <td className="header">OTD year %</td>
              <td className="header">Premium freight</td>
              <td className="header">Freight target</td>
              <td className="header">Warranty % of sales</td>
              <td className="header">Warranty target</td>
              <td className="header">Production volume</td>
            </tr>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{row.name || `Row ${index + 1}`}</td>
                <td className={higherBetterFill(parseMeasure(row.otdMonth), parseMeasure(row.otdTarget))}>
                  <Num label={`OTD month ${index + 1}`} value={row.otdMonth} readOnly={readOnly} onChange={(value) => edit(index, { otdMonth: value })} />
                </td>
                <td>
                  <Num label={`OTD target ${index + 1}`} value={row.otdTarget} readOnly={readOnly} onChange={(value) => edit(index, { otdTarget: value })} />
                </td>
                <td className={higherBetterFill(parseMeasure(row.otdYear), parseMeasure(row.otdTarget))}>
                  <Num label={`OTD year ${index + 1}`} value={row.otdYear} readOnly={readOnly} onChange={(value) => edit(index, { otdYear: value })} />
                </td>
                <td className={lowerBetterFill(parseMeasure(row.freightMonth), parseMeasure(row.freightTarget))}>
                  <Num label={`Freight ${index + 1}`} value={row.freightMonth} readOnly={readOnly} onChange={(value) => edit(index, { freightMonth: value })} />
                </td>
                <td>
                  <Num label={`Freight target ${index + 1}`} value={row.freightTarget} readOnly={readOnly} onChange={(value) => edit(index, { freightTarget: value })} />
                </td>
                <td className={lowerBetterFill(parseMeasure(row.warrantyMonth), parseMeasure(row.warrantyTarget))}>
                  <Num label={`Warranty ${index + 1}`} value={row.warrantyMonth} readOnly={readOnly} onChange={(value) => edit(index, { warrantyMonth: value })} />
                </td>
                <td>
                  <Num label={`Warranty target ${index + 1}`} value={row.warrantyTarget} readOnly={readOnly} onChange={(value) => edit(index, { warrantyTarget: value })} />
                </td>
                <td>
                  <Num label={`Volume ${index + 1}`} value={row.volume} readOnly={readOnly} onChange={(value) => edit(index, { volume: value })} />
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={9} className="note">
                % year for PPM and NCT is 100% when year-to-date is inside the target, otherwise target ÷ year-to-date. The global NCT row uses year-to-date ÷ target when the count is over target, matching the source sheet.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="no-print flex gap-2">
          <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => onCustomers([...rows, blankScorecardRow()])}>
            Add customer
          </button>
          {rows.length > 1 && (
            <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => onCustomers(rows.slice(0, -1))}>
              Remove last row
            </button>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            First row is the global target
            <input
              type="checkbox"
              checked={rows[0]?.band === "global"}
              onChange={(event) => edit(0, { band: event.target.checked ? "global" : "customer" })}
            />
          </label>
        </div>
      )}

      {chartRows.length > 0 && (
        <div className="sheet-chart grid gap-4 lg:grid-cols-3">
          {(
            [
              ["ppm", "PPM % of target"],
              ["nct", "NCT % of target"],
              ["otd", "On-time delivery %"],
            ] as const
          ).map(([key, title]) => (
            <div key={key} className="rounded-lg border border-border bg-card p-3">
              <h3 className="mb-2 text-center text-sm font-semibold">{title}</h3>
              <ResponsiveContainer width="100%" height={260}>
                <RadarChart data={chartRows}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="name" tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} />
                  <Radar dataKey={key} stroke="#2451ff" fill="#2451ff" fillOpacity={0.35} />
                  <Legend />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

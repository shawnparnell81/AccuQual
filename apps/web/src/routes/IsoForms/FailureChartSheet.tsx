import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  FAILURE_MONTHS,
  PCA_OPTIONS,
  blankFailureRow,
  failureColumnTotals,
  failureRowTotal,
  formatCount,
  pcaFill,
  sumNumbers,
  topFailureProblems,
  type FailureRow,
} from "../../lib/qualitySheetLogic";
import { sheetRevision } from "../../lib/formDocument";
import "./isoForm.css";

interface FailureChartSheetProps {
  months: string[];
  problems: FailureRow[];
  readOnly?: boolean;
  onMonths: (months: string[]) => void;
  onProblems: (problems: FailureRow[]) => void;
  documentNumber?: string;
}

function visibleMonths(months: string[]): string[] {
  if (months.length > 0) return months;
  return [...FAILURE_MONTHS];
}

function visibleProblems(problems: FailureRow[], monthCount: number): FailureRow[] {
  const sized = problems.map((row) => ({
    ...row,
    months: Array.from({ length: monthCount }, (_, index) => row.months[index] ?? ""),
  }));
  if (sized.length > 0) return sized;
  return Array.from({ length: 8 }, () => blankFailureRow(monthCount));
}

export function FailureChartSheet({ months, problems, readOnly = false, onMonths, onProblems, documentNumber = "" }: FailureChartSheetProps) {
  const headers = visibleMonths(months);
  const rows = visibleProblems(problems, headers.length);
  const totals = failureColumnTotals(rows, headers.length);
  const lineData = headers.map((month, index) => ({ month, rejected: totals[index] ?? 0 }));
  const top = topFailureProblems(rows);

  function rememberMonths() {
    if (months.length === 0) onMonths(headers);
  }

  function editMonth(index: number, value: string) {
    onMonths(headers.map((month, monthIndex) => (monthIndex === index ? value : month)));
  }

  function editRow(index: number, patch: Partial<FailureRow>) {
    rememberMonths();
    onProblems(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function editCount(rowIndex: number, monthIndex: number, value: string) {
    const row = rows[rowIndex];
    if (!row) return;
    const nextMonths = row.months.map((count, index) => (index === monthIndex ? value : count));
    editRow(rowIndex, { months: nextMonths });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="iso-wrap">
        <table className="iso" data-testid="failure-chart-sheet" aria-label="Failure Action Effectiveness Chart">
          <tbody>
            <tr>
              <td className="title" colSpan={headers.length + 6}>
                FAILURE / ACTION / EFFECTIVENESS CHART
              </td>
            </tr>
            <tr>
              <td colSpan={headers.length + 6}>{sheetRevision(documentNumber)}</td>
            </tr>
            <tr>
              <td className="header">No.</td>
              <td className="header">Claimed parts</td>
              <td className="header">OP</td>
              <td className="header">Problem description</td>
              <td className="header">PCA implemented</td>
              {headers.map((month, index) => (
                <td key={index} className="header">
                  <input className="iso-in center" aria-label={`Month ${index + 1}`} value={month} disabled={readOnly} onChange={(event) => editMonth(index, event.target.value)} />
                </td>
              ))}
              <td className="header">Total</td>
            </tr>
            {rows.map((row, index) => (
              <tr key={index}>
                <td className="center">{index + 1}</td>
                <td>
                  <input className="iso-in center" inputMode="decimal" aria-label={`Claimed parts ${index + 1}`} value={row.claimed} disabled={readOnly} onChange={(event) => editRow(index, { claimed: event.target.value })} />
                </td>
                <td>
                  <input className="iso-in" aria-label={`OP ${index + 1}`} value={row.op} disabled={readOnly} onChange={(event) => editRow(index, { op: event.target.value })} />
                </td>
                <td>
                  <input className="iso-in" aria-label={`Problem ${index + 1}`} value={row.problem} disabled={readOnly} onChange={(event) => editRow(index, { problem: event.target.value })} />
                </td>
                <td className={pcaFill(row.pca)}>
                  <select className="iso-in" aria-label={`PCA ${index + 1}`} value={row.pca} disabled={readOnly} onChange={(event) => editRow(index, { pca: event.target.value })}>
                    {PCA_OPTIONS.map((option) => (
                      <option key={option || "blank"} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </td>
                {headers.map((_, monthIndex) => (
                  <td key={monthIndex}>
                    <input
                      className="iso-in center"
                      inputMode="decimal"
                      aria-label={`Problem ${index + 1} ${headers[monthIndex]}`}
                      value={row.months[monthIndex] ?? ""}
                      disabled={readOnly}
                      onChange={(event) => editCount(index, monthIndex, event.target.value)}
                    />
                  </td>
                ))}
                <td className="center">{formatCount(failureRowTotal(row))}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={5}>Parts rejected this month</td>
              {totals.map((total, index) => (
                <td key={index} className="center">
                  {formatCount(total)}
                </td>
              ))}
              <td className="center">{formatCount(sumNumbers(totals))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="no-print flex gap-2">
          <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => onProblems([...rows, blankFailureRow(headers.length)])}>
            Add problem
          </button>
          {rows.length > 1 && (
            <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => onProblems(rows.slice(0, -1))}>
              Remove last row
            </button>
          )}
        </div>
      )}
      <div className="sheet-chart grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <h3 className="mb-2 text-sm font-semibold">YTD warranty vs. part production date</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="rejected" name="Parts rejected" stroke="#c23b2c" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <h3 className="mb-2 text-sm font-semibold">Top 5 Pareto</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={top}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="problem" tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} interval={0} />
              <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="total" name="Claimed parts" fill="#2451ff" radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

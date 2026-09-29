import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "../../../routes/IsoForms/isoForm.css";

interface CustomFormProps {
  data: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}

interface ProblemRow {
  description: string;
  quantity: number;
}

/**
 * Pareto chart, derived from the source Pareto template.
 * Cumulative % is SUM(quantity so far) / SUM(all quantities), the sheet formula
 * SUM($C$8:Cn)/SUM($C$8:$C$18), after the rows are ordered by quantity.
 * Sort order and cumulative % are inherently whole-table computations (every
 * row's % depends on every other row's quantity and the sort order they
 * produce), which doesn't fit the row-by-row computed-column model the rest
 * of the forms engine uses — so, like Gage R&R, this is a bespoke component
 * rather than a layouts/*.ts schema. Only the raw (description, quantity)
 * rows are persisted; the sort and cumulative % are always re-derived so
 * they can never go stale relative to the raw counts.
 */
export function ParetoChartForm({ data, onChange }: CustomFormProps) {
  const rows: ProblemRow[] = Array.isArray(data.problems) ? (data.problems as ProblemRow[]) : [{ description: "", quantity: 0 }];

  const total = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  const sorted = [...rows]
    .filter((r) => r.description || r.quantity)
    .sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0));

  let running = 0;
  const chartData = sorted.map((r) => {
    running += Number(r.quantity) || 0;
    return {
      description: r.description || "(untitled)",
      quantity: Number(r.quantity) || 0,
      cumulativePct: total ? Math.round((running / total) * 1000) / 10 : 0,
    };
  });

  function updateRow(index: number, patch: Partial<ProblemRow>) {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange("problems", next);
  }

  function addRow() {
    onChange("problems", [...rows, { description: "", quantity: 0 }]);
  }

  function removeRow(index: number) {
    onChange("problems", rows.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="iso-wrap aq-print-sheet">
        <table className="iso" data-testid="pareto-sheet" aria-label="Pareto Chart">
          <tbody>
            <tr>
              <td className="title" colSpan={4}>
                PARETO DYNAMIC DIAGRAM
              </td>
            </tr>
            <tr>
              <td colSpan={4}>Doc ID: FRM-PAR-001 · Rev: A</td>
            </tr>
            <tr>
              <td className="header">Problem description</td>
              <td className="header">Quantity</td>
              <td className="header">%</td>
              <td className="header no-print" />
            </tr>
            {rows.map((row, index) => {
              const rank = sorted.findIndex((item) => item === row || (item.description === row.description && item.quantity === row.quantity));
              const cumulative = rank >= 0 && chartData[rank] ? chartData[rank].cumulativePct : null;
              return (
                <tr key={index}>
                  <td>
                    <input className="iso-in" aria-label={`Problem ${index + 1}`} value={row.description} onChange={(event) => updateRow(index, { description: event.target.value })} />
                  </td>
                  <td>
                    <input className="iso-in center" type="number" aria-label={`Quantity ${index + 1}`} value={row.quantity || ""} onChange={(event) => updateRow(index, { quantity: event.target.valueAsNumber || 0 })} />
                  </td>
                  <td className="center">{cumulative == null ? "" : `${cumulative.toFixed(1)}%`}</td>
                  <td className="center no-print">
                    <button type="button" onClick={() => removeRow(index)} className="text-muted-foreground hover:text-destructive" aria-label={`Remove row ${index + 1}`}>
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" onClick={addRow} className="no-print mt-2 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
          Add row
        </button>
      </div>

      {chartData.length > 0 && (
        <div className="sheet-chart rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Pareto dynamic diagram</h3>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="description" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }} height={70} />
              <YAxis yAxisId="left" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--foreground))" }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(value: number) => `${value}%`} tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--foreground))" }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="quantity" name="Quantity" fill="#2451ff" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="cumulativePct" name="Cumulative %" stroke="#c23b2c" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

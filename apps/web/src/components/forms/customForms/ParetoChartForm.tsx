import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface CustomFormProps {
  data: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}

interface ProblemRow {
  description: string;
  quantity: number;
}

const INPUT_CLASS = "w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary";

/**
 * Pareto chart, derived 1:1 from the user-provided "Pareto_Chart_Template.pdf".
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
    <div className="flex flex-col gap-5 text-sm">
      <h2 className="text-center text-base font-bold uppercase tracking-wide text-slate-800">Pareto Chart</h2>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border border-slate-200 bg-slate-100 px-2 py-1.5 text-left">Problem Description</th>
              <th className="w-28 border border-slate-200 bg-slate-100 px-2 py-1.5 text-left">Quantity</th>
              <th className="w-24 border border-slate-200 bg-slate-100 px-2 py-1.5 text-left">Cumulative %</th>
              <th className="w-8 border border-slate-200 bg-slate-100" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const rank = sorted.findIndex((r) => r === row || (r.description === row.description && r.quantity === row.quantity));
              const cumPct = rank >= 0 && chartData[rank] ? chartData[rank].cumulativePct : null;
              return (
                <tr key={i}>
                  <td className="border border-slate-200 p-0.5">
                    <input
                      className={INPUT_CLASS}
                      value={row.description}
                      onChange={(e) => updateRow(i, { description: e.target.value })}
                    />
                  </td>
                  <td className="border border-slate-200 p-0.5">
                    <input
                      type="number"
                      className={INPUT_CLASS}
                      value={row.quantity || ""}
                      onChange={(e) => updateRow(i, { quantity: e.target.valueAsNumber || 0 })}
                    />
                  </td>
                  <td className="border border-slate-200 px-2 py-1 text-slate-600">{cumPct === null ? "—" : `${cumPct}%`}</td>
                  <td className="border border-slate-200 text-center">
                    <button onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive" aria-label="Remove row">
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button onClick={addRow} className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
          + Add row
        </button>
      </div>

      {chartData.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Pareto Diagram</h3>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="description"
                angle={-35}
                textAnchor="end"
                interval={0}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                height={70}
              />
              <YAxis yAxisId="left" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip />
              <Bar yAxisId="left" dataKey="quantity" fill="#2451FF" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="cumulativePct" stroke="#C23B2C" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

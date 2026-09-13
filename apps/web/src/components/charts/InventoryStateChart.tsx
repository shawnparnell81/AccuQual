import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface InventoryStateDatum {
  state: string;
  count: number;
}

// Same semantic weight as SeverityChart/CapaEffectivenessChart's palette
// (green = resolved/healthy, amber = needs attention, blue = action under
// way, purple = waiting, orange = still a problem, slate = inert) rather
// than a fresh palette per chart.
const COLORS: Record<string, string> = {
  in_stock: "#10b981",
  below_min: "#f59e0b",
  reorder_pending: "#60a5fa",
  on_order: "#a78bfa",
  overstock: "#fb923c",
  inactive: "#94a3b8",
};

const LABELS: Record<string, string> = {
  in_stock: "In Stock",
  below_min: "Below Min",
  reorder_pending: "Reorder Pending",
  on_order: "On Order",
  overstock: "Overstock",
  inactive: "Inactive",
};

/**
 * A live distribution of items by state, not a time-series trend — AccuQual
 * doesn't store item state history (only the current column + the audit
 * trail's individual transition rows), so there's no real "min/max trend
 * over time" data to chart. This is the same honest substitution
 * CapaEffectivenessChart already makes for its "chart" (a live status
 * breakdown, not an actual over-time trend).
 */
export function InventoryStateChart({ data }: { data: InventoryStateDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis
          dataKey="state"
          tickFormatter={(s: string) => LABELS[s] ?? s}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
        />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <Tooltip labelFormatter={(s: string) => LABELS[s] ?? s} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.state} fill={COLORS[entry.state] ?? "#64748b"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TrendDatum {
  month: string;
  count: number;
}

/** Phase 6 Reporting Hub — a real month-over-month trend line, the widget type the hub's task list named that nothing existing built (every prior chart in this app is a current-state snapshot, not a series over time). */
export function TrendLineChart({ data, label = "Count" }: { data: TrendDatum[]; label?: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <Tooltip />
        <Line type="monotone" dataKey="count" name={label} stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

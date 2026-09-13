import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ConsumptionVsReceivingPoint } from "../../api/types";

/** Two-line comparison of total consumed vs. total received per bucket — the same real movements as MovementTrendsChart, isolated to the two flows that matter most for reorder planning. */
export function ConsumptionVsReceivingChart({ data }: { data: ConsumptionVsReceivingPoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No consumption or receiving logged in this window.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="consumed" name="Consumed" stroke="#f59e0b" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="received" name="Received" stroke="#10b981" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

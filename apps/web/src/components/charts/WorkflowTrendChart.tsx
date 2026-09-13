import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthBucket } from "../../lib/workflowMetrics";

/**
 * Generic month-bucketed activity chart — the one shared "WorkflowTrendChart"
 * every module's dashboard section uses, fed by lib/workflowMetrics.ts's
 * bucketByMonth() over whatever real date field that module actually has
 * (closedAt, completedAt, updatedAt, ...). Same recharts + token-driven axis
 * styling as the existing SeverityChart/CapaEffectivenessChart, just generic
 * over the series instead of one hardcoded shape per chart.
 */
export function WorkflowTrendChart({ data, color = "hsl(var(--primary))" }: { data: MonthBucket[]; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

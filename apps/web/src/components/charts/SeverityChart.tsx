import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS } from "./chartPalette";

export interface SeverityDatum {
  severity: string;
  count: number;
}

const COLORS: Record<string, string> = {
  low: CHART_COLORS.inert,
  medium: CHART_COLORS.attention,
  high: CHART_COLORS.problem,
  critical: CHART_COLORS.critical,
};

export function SeverityChart({ data }: { data: SeverityDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="severity" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <Tooltip />
        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.severity} fill={COLORS[entry.severity] ?? CHART_COLORS.fallback} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MovementTrendPoint } from "../../api/types";

const COLORS: Record<string, string> = {
  receive: "#10b981",
  consume: "#f59e0b",
  produce: "#60a5fa",
  adjust: "#a78bfa",
  scrap: "#e11d48",
  transfer: "#94a3b8",
};

const SERIES = ["receive", "consume", "produce", "adjust", "scrap", "transfer"] as const;

/** Total quantity moved per day/week, one line per movement type — real inventory_movements rows, bucketed in JS (see inventory.analytics.ts). */
export function MovementTrendsChart({ data }: { data: MovementTrendPoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No movements logged in this window.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {SERIES.map((s) => (
          <Line key={s} type="monotone" dataKey={s} stroke={COLORS[s]} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

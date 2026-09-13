import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BUCKET_BY_STATUS, type StatusBucket } from "../tables/StatusBadge";

const BUCKET_COLORS: Record<StatusBucket, string> = {
  muted: "hsl(var(--muted-foreground))",
  info: "hsl(var(--info))",
  warning: "hsl(var(--warning))",
  success: "hsl(var(--success))",
  destructive: "hsl(var(--destructive))",
};

export interface StateDatum {
  status: string;
  count: number;
}

/**
 * Cross-module state distribution — each bar colored by the exact same
 * bucket StatusBadge already uses for that status, so a bar chart here and a
 * badge on a record's own detail page always agree on what color a given
 * status is. This is what makes "supports cross-module comparison" (the
 * brief's phrase) actually true: an NCR's "open" and a Supplier's "active"
 * read as the same kind of state (warning vs. success) at a glance, not
 * just visually distinct hues with no shared meaning.
 */
export function WorkflowStateDistributionChart({ data }: { data: StateDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
        <YAxis
          type="category"
          dataKey="status"
          tickFormatter={(s: string) => s.replace(/_/g, " ")}
          tickLine={false}
          axisLine={false}
          width={100}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
        />
        <Tooltip labelFormatter={(s: string) => s.replace(/_/g, " ")} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((entry) => (
            <Cell key={entry.status} fill={BUCKET_COLORS[BUCKET_BY_STATUS[entry.status] ?? "muted"]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

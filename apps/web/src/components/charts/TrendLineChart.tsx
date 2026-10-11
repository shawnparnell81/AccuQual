import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TrendDatum {
  month: string;
  count: number | null;
  compare?: number | null;
}

/** Month-over-month line. A dashed reference line is the objective target when one is set. */
export function TrendLineChart({
  data,
  label = "Count",
  target,
  compareLabel,
  onPoint,
}: {
  data: TrendDatum[];
  label?: string;
  target?: number | null;
  compareLabel?: string;
  onPoint?: (month: string) => void;
}) {
  const decimals = data.some((row) => !Number.isInteger(row.count ?? 0) || !Number.isInteger(row.compare ?? 0)) || (target != null && !Number.isInteger(target));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart
        data={data}
        onClick={(state) => {
          const month = (state?.activePayload?.[0]?.payload as TrendDatum | undefined)?.month;
          if (month) onPoint?.(month);
        }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={decimals} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
        <Tooltip />
        {(compareLabel || target != null) && <Legend />}
        {target != null && <ReferenceLine y={target} stroke="hsl(var(--muted-foreground))" strokeDasharray="6 4" ifOverflow="extendDomain" label={{ value: "Target", fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />}
        <Line
          type="monotone"
          dataKey="count"
          name={label}
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          connectNulls={false}
          dot={{ r: 3, fill: "hsl(var(--accent))", stroke: "hsl(var(--accent))" }}
          activeDot={{ r: 5, fill: "hsl(var(--accent))", stroke: "hsl(var(--accent))" }}
        />
        {compareLabel && <Line type="monotone" dataKey="compare" name={compareLabel} stroke="hsl(200 65% 42%)" strokeWidth={2} connectNulls={false} dot={{ r: 2 }} />}
      </LineChart>
    </ResponsiveContainer>
  );
}

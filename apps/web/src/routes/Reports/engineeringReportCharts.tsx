import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS } from "../../components/charts/chartPalette";

const tick = { fill: "hsl(var(--foreground))", fontSize: 12 };
const grid = "hsl(var(--border))";
const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--foreground))",
  borderRadius: 8,
};

const SERIES = [CHART_COLORS.active, CHART_COLORS.attention, CHART_COLORS.resolved, CHART_COLORS.problem, CHART_COLORS.waiting, CHART_COLORS.critical];

function EmptyChart({ label }: { label: string }) {
  return <p className="text-sm text-muted-foreground">{label}</p>;
}

export function ClaimsReturnsChart({ rows, scope }: { rows: { date: string; claims: number; returns: number }[]; scope: "month" | "file" | "empty" }) {
  if (rows.length === 0) return <EmptyChart label="Upload a supplier file with a claims_series dataset to draw claims and returns." />;
  return (
    <div className="flex flex-col gap-2">
      {scope === "file" && <p className="text-xs text-muted-foreground">None of these dates fall in the selected month, so the chart shows every date in the file.</p>}
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tick={tick} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={tick} />
          <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "hsl(var(--foreground))" }} itemStyle={{ color: "hsl(var(--foreground))" }} />
          <Legend formatter={(value) => <span style={{ color: "hsl(var(--foreground))" }}>{value}</span>} />
          <Line type="monotone" dataKey="claims" name="Claims" stroke={CHART_COLORS.active} strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="returns" name="Returns" stroke={CHART_COLORS.critical} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FuelPumpChart({ rows }: { rows: { source: string; count: number }[] }) {
  if (rows.length === 0) return <EmptyChart label="Upload fuel_pump_returns to draw the breakdown." />;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={rows}
          dataKey="count"
          nameKey="source"
          outerRadius={90}
          label={(entry: { x?: number; y?: number; name?: string; value?: number }) => (
            <text x={entry.x} y={entry.y} fill="hsl(var(--foreground))" fontSize={12} textAnchor="middle">
              {`${entry.name ?? ""}: ${entry.value ?? ""}`}
            </text>
          )}
        >
          {rows.map((row, index) => (
            <Cell key={row.source} fill={SERIES[index % SERIES.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "hsl(var(--foreground))" }} />
        <Legend formatter={(value) => <span style={{ color: "hsl(var(--foreground))" }}>{value}</span>} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function VehicleChart({ rows }: { rows: { vehicle: string; claims: number }[] }) {
  if (rows.length === 0) return <EmptyChart label="Upload top_vehicles to draw the bar chart." />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(240, rows.length * 32)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 24, right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={grid} />
        <XAxis type="number" tick={tick} allowDecimals={false} />
        <YAxis type="category" dataKey="vehicle" width={180} tick={tick} />
        <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "hsl(var(--foreground))" }} />
        <Bar dataKey="claims" name="Claims" fill={CHART_COLORS.active} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function EmailIssuesChart({ rows }: { rows: { label: string; totalIssues: number | null; orIssues: number | null; napaIssues: number | null }[] }) {
  const plotted = rows.filter((row) => row.totalIssues != null || row.orIssues != null || row.napaIssues != null);
  if (plotted.length === 0) return <EmptyChart label="Upload email_issues to draw OR and NAPA totals." />;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={plotted}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} />
        <XAxis dataKey="label" tick={tick} />
        <YAxis tick={tick} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "hsl(var(--foreground))" }} />
        <Legend formatter={(value) => <span style={{ color: "hsl(var(--foreground))" }}>{value}</span>} />
        <Bar dataKey="totalIssues" name="Total issues" fill={CHART_COLORS.inert} />
        <Bar dataKey="orIssues" name="O'Reilly" fill={CHART_COLORS.attention} />
        <Bar dataKey="napaIssues" name="NAPA" fill={CHART_COLORS.active} />
      </BarChart>
    </ResponsiveContainer>
  );
}

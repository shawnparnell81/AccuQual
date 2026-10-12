import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FaiAgingPoint, FaiPassRatePoint, FaiSupplierFailurePoint, FaiTriggerReasonPoint } from "../../api/faiInspection";
import { CHART_COLORS } from "./chartPalette";

/** FAI pass rate by month, last 12 months. Stacked passed/failed so the raw counts are visible alongside the rate. */
export function FaiPassRateChart({ data, onBarClick }: { data: FaiPassRatePoint[]; onBarClick?: (month: string, status: "passed" | "failed") => void }) {
  if (data.every((d) => d.total === 0)) return <p className="text-sm text-muted-foreground">No records yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="passed" name="Passed" stackId="r" fill={CHART_COLORS.resolved} onClick={(d: any) => onBarClick?.(d.month, "passed")} cursor="pointer" />
        <Bar dataKey="failed" name="Failed" stackId="r" fill={CHART_COLORS.critical} radius={[4, 4, 0, 0]} onClick={(d: any) => onBarClick?.(d.month, "failed")} cursor="pointer" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** FAIs by trigger reason. */
export function FaiTriggerReasonChart({ data, onBarClick }: { data: FaiTriggerReasonPoint[]; onBarClick?: (triggerReason: string) => void }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No records yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <YAxis type="category" dataKey="triggerReason" tickLine={false} axisLine={false} width={140} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="count" fill={CHART_COLORS.active} radius={[0, 6, 6, 0]} onClick={(d: any) => onBarClick?.(d.triggerReason)} cursor="pointer" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Failures by supplier, top 10. */
export function FaiSupplierFailuresChart({ data, onBarClick }: { data: FaiSupplierFailurePoint[]; onBarClick?: (supplierName: string) => void }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No records yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <YAxis type="category" dataKey="supplierName" tickLine={false} axisLine={false} width={140} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="failures" fill={CHART_COLORS.critical} radius={[0, 6, 6, 0]} onClick={(d: any) => onBarClick?.(d.supplierName)} cursor="pointer" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Aging of open FAIs. */
export function FaiAgingChart({ data, onBarClick }: { data: FaiAgingPoint[]; onBarClick?: (bucket: string) => void }) {
  if (data.every((d) => d.count === 0)) return <p className="text-sm text-muted-foreground">No records yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <Tooltip />
        <Bar dataKey="count" fill={CHART_COLORS.attention} radius={[4, 4, 0, 0]} onClick={(d: any) => onBarClick?.(d.bucket)} cursor="pointer" />
      </BarChart>
    </ResponsiveContainer>
  );
}

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface CapaStatusDatum {
  status: string;
  count: number;
}

const COLORS: Record<string, string> = {
  open: "#f59e0b",
  in_progress: "#60a5fa",
  verifying: "#a78bfa",
  closed: "#10b981",
};

const LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  verifying: "Verifying",
  closed: "Closed",
};

/**
 * Live corrective-action effectiveness breakdown — the dashboard equivalent
 * of the source spreadsheet's static "Failure / Action / Effectiveness
 * Chart" template, built from AccuQual's real CAPA records instead of a
 * pasted snapshot, so it updates the moment CAPA data changes like every
 * other dashboard KPI.
 */
export function CapaEffectivenessChart({ data }: { data: CapaStatusDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="status" tickFormatter={(s: string) => LABELS[s] ?? s} tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip labelFormatter={(s: string) => LABELS[s] ?? s} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.status} fill={COLORS[entry.status] ?? "#64748b"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

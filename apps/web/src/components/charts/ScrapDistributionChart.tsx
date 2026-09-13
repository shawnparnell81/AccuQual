import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ScrapByItemDatum {
  sku: string;
  quantity: number;
}

/** Scrap quantity by item (real inventory_movements rows where movement_type="scrap"). The by-referenceType breakdown is shown as a compact list alongside this, not a second chart — too few categories (production_log/manual/none) to need one. */
export function ScrapDistributionChart({ data }: { data: ScrapByItemDatum[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No scrap logged yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <YAxis type="category" dataKey="sku" tickLine={false} axisLine={false} width={90} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="quantity" fill="#e11d48" radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

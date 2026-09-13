import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface SupplierCostDatum {
  supplierName: string;
  itemValue: number;
}

/** Current inventory value grouped by supplier — real inventory_items.unitCost * on_hand, summed per default_supplier_id (see inventory.costing.ts). Only suppliers with at least one costed, linked item appear. */
export function SupplierCostChart({ data }: { data: SupplierCostDatum[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No supplier has a costed, linked item yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v}`} tick={{ fill: "hsl(var(--muted-foreground))" }} />
        <YAxis type="category" dataKey="supplierName" tickLine={false} axisLine={false} width={110} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
        <Tooltip formatter={(v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
        <Bar dataKey="itemValue" fill="#10b981" radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface HeatmapCell {
  label: string;
  value: number;
}

const INTENSITY_CLASSES = ["bg-muted", "bg-warning/20", "bg-warning/40", "bg-warning/60", "bg-destructive/50", "bg-destructive/70"];

/**
 * Phase 6 Reporting Hub — the heatmap widget type the hub's task list
 * named. A lightweight CSS-grid tile grid (no new charting dependency —
 * this app's whole charting need has been well served by recharts alone
 * everywhere else) rather than a true 2D heatmap: today's real reporting
 * data (risk-level buckets, severity buckets) is naturally a small set of
 * named categories, not a real X/Y matrix, so a colored tile per category
 * reads the same at a glance without inventing axes that don't exist yet.
 */
export function RiskHeatmap({ cells }: { cells: HeatmapCell[] }) {
  const max = Math.max(1, ...cells.map((c) => c.value));
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((cell) => {
        const intensity = Math.min(INTENSITY_CLASSES.length - 1, Math.floor((cell.value / max) * (INTENSITY_CLASSES.length - 1)));
        return (
          <div key={cell.label} className={`rounded-lg border border-border p-3 text-center ${INTENSITY_CLASSES[intensity]}`}>
            <p className="text-2xl font-semibold">{cell.value}</p>
            <p className="text-xs capitalize text-muted-foreground">{cell.label}</p>
          </div>
        );
      })}
    </div>
  );
}

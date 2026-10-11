import { Pin, PinOff, X } from "lucide-react";
import { TrendLineChart } from "../charts/TrendLineChart";
import { formatKpiValue, pointValue, shortMonth, targetFor, type KpiChartDef, type KpiMetric, type KpiObjective, type KpiPlant, type PlantView } from "../../lib/kpiView";

export function KpiChartCard({
  chart,
  metrics,
  objectives,
  plants,
  plant,
  onOpen,
  pinnedHome,
  pinnedExecutive,
  onPinHome,
  onPinExecutive,
  onRemove,
  onMove,
  compact,
}: {
  chart: KpiChartDef;
  metrics: KpiMetric[];
  objectives: KpiObjective[];
  plants: KpiPlant[];
  plant: PlantView;
  onOpen?: (metricId: string, month: string) => void;
  pinnedHome?: boolean;
  pinnedExecutive?: boolean;
  onPinHome?: () => void;
  onPinExecutive?: () => void;
  onRemove?: () => void;
  onMove?: (direction: -1 | 1) => void;
  compact?: boolean;
}) {
  const metric = metrics.find((item) => item.id === chart.metricId);
  const compare = chart.compareMetricId ? metrics.find((item) => item.id === chart.compareMetricId) : undefined;
  if (!metric) return null;
  const showSplit = metric.plantSplit && (compare == null || compare.plantSplit);
  const data = metric.points.map((point, index) => ({
    month: shortMonth(point.month),
    key: point.month,
    count: pointValue(point, showSplit ? plant : "all", metric.plantSplit),
    compare: compare ? pointValue(compare.points[index] ?? point, showSplit ? plant : "all", compare.plantSplit) : undefined,
  }));
  const target = targetFor(chart, objectives, plant, plants);
  const latest = [...metric.points].reverse().find((point) => pointValue(point, showSplit ? plant : "all", metric.plantSplit) != null);
  const latestValue = latest ? pointValue(latest, showSplit ? plant : "all", metric.plantSplit) : null;
  const note = [metric.note, compare?.note].filter(Boolean).join(" ");
  const plantLabel = !showSplit ? "All plants" : plant === "all" ? "All plants" : plants.find((item) => item.id === plant)?.name ?? "Plant";

  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{chart.label}</h3>
          <p className="text-xs text-muted-foreground">
            {plantLabel}
            {latest ? ` · ${formatKpiValue(metric.unit, latestValue)}` : ""}
          </p>
        </div>
        <div className="no-print flex shrink-0 flex-wrap justify-end gap-1">
          {onPinHome && (
            <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={onPinHome}>
              {pinnedHome ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              {pinnedHome ? "Remove from Home" : "Add to Home"}
            </button>
          )}
          {onPinExecutive && (
            <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={onPinExecutive}>
              {pinnedExecutive ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              {pinnedExecutive ? "Remove from Executive" : "Add to Executive dashboard"}
            </button>
          )}
          {onMove && (
            <>
              <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => onMove(-1)}>
                Up
              </button>
              <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => onMove(1)}>
                Down
              </button>
            </>
          )}
          {onRemove && (
            <button type="button" className="rounded-md border border-border p-1 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label={`Remove ${chart.label}`} title="Remove">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <TrendLineChart
        data={data.map((row) => ({ month: row.month, count: row.count, compare: row.compare }))}
        label={metric.label}
        compareLabel={compare?.label}
        target={target}
        onPoint={(label) => {
          const hit = data.find((row) => row.month === label);
          if (hit && onOpen) onOpen(metric.id, hit.key);
        }}
      />
      {target != null && <p className="text-xs text-muted-foreground">Dashed line is the target ({formatKpiValue(metric.unit, target)}).</p>}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {!compact && <p className="text-xs text-muted-foreground">{metric.definition}</p>}
    </article>
  );
}

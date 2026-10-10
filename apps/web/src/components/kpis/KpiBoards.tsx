import { useState } from "react";
import { useSiteStore } from "../../store/siteStore";
import { useKpis } from "../../hooks/useKpis";
import { defaultPlantView, moveChart, pinChart, toggleChart, unpinChart, type KpiChartDef, type KpiPayload, type PlantView } from "../../lib/kpiView";
import { KpiChartCard } from "./KpiChartCard";
import { UpdatedStamp } from "./UpdatedStamp";

export function plantChoices(plants: KpiPayload["plants"]): { id: PlantView; label: string }[] {
  const named = plants.filter((plant) => plant.token === "greer" || plant.token === "wellman");
  return [{ id: "all", label: "All" }, ...named.map((plant) => ({ id: plant.id, label: plant.name }))];
}

export function PlantToggle({ plant, plants, onChange }: { plant: PlantView; plants: KpiPayload["plants"]; onChange: (next: PlantView) => void }) {
  const choices = plantChoices(plants);
  const current = choices.find((choice) => choice.id === plant)?.label ?? "All";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-foreground">Plant: {current}</p>
      <div className="no-print inline-flex overflow-hidden rounded-md border border-border text-xs font-semibold">
        {choices.map((choice) => (
          <button
            key={String(choice.id)}
            type="button"
            aria-pressed={choice.id === plant}
            className={`px-3 py-1.5 ${choice.id === plant ? "bg-primary/15 text-foreground" : "text-muted-foreground"}`}
            onClick={() => onChange(choice.id)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function usePlantChoice(plants: KpiPayload["plants"] | undefined): [PlantView, (next: PlantView) => void] {
  const siteScope = useSiteStore((state) => state.siteScope);
  const currentSiteId = useSiteStore((state) => state.currentSiteId);
  const fallback = defaultPlantView(plants ?? [], siteScope, currentSiteId);
  const [chosen, setChosen] = useState<PlantView | null>(null);
  return [chosen ?? fallback, setChosen];
}

function areasOf(charts: KpiChartDef[]): string[] {
  const areas: string[] = [];
  for (const chart of charts) if (!areas.includes(chart.area)) areas.push(chart.area);
  return areas;
}

/** Checkboxes in Customize / Arrange, plus Reset to default. */
export function KpiChartCustomize({ surface }: { surface: "home" | "executive" }) {
  const { query, saveOrder, resetLayout, pending } = useKpis();
  const data = query.data;
  if (!data) return null;
  const order = surface === "home" ? data.layout.home : data.layout.executive;
  const isDefault = surface === "home" ? data.layout.homeIsDefault : data.layout.executiveIsDefault;
  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">KPI charts on this page. Reset puts the standard charts back.</p>
        <button type="button" disabled={pending || isDefault} onClick={() => resetLayout(surface)} className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
          Reset to default
        </button>
      </div>
      {areasOf(data.charts).map((area) => (
        <div key={area} className="mb-2">
          <p className="text-xs font-semibold text-foreground">{area}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {data.charts
              .filter((chart) => chart.area === area)
              .map((chart) => (
                <li key={chart.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={order.includes(chart.id)}
                    aria-label={`${order.includes(chart.id) ? "Remove" : "Add"} ${chart.label}`}
                    disabled={pending}
                    onChange={() => saveOrder({ surface, order: toggleChart(order, chart.id) })}
                  />
                  <span className="min-w-0 flex-1 truncate">{chart.label}</span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Charts this person pinned to Home or the executive dashboard. */
export function KpiPinnedCharts({
  surface,
  onOpen,
}: {
  surface: "home" | "executive";
  onOpen?: (metricId: string, month: string, plant: PlantView) => void;
}) {
  const { query, saveOrder } = useKpis();
  const data = query.data;
  const [plant, setPlant] = usePlantChoice(data?.plants);
  const [dragId, setDragId] = useState<string | null>(null);
  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading KPI charts…</p>;
  if (!data) return null;
  const order = surface === "home" ? data.layout.home : data.layout.executive;
  const charts = order.map((id) => data.charts.find((chart) => chart.id === id)).filter((chart): chart is KpiChartDef => chart != null);
  const available = data.charts.filter((chart) => !order.includes(chart.id));

  function commit(next: string[]) {
    saveOrder({ surface, order: next });
  }

  function dropOn(id: string) {
    if (!dragId || dragId === id) return;
    const from = order.indexOf(dragId);
    const to = order.indexOf(id);
    setDragId(null);
    if (from < 0 || to < 0) return;
    const next = [...order];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row!);
    commit(next);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">KPI charts</h2>
          <UpdatedStamp at={data.computedAt} />
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <PlantToggle plant={plant} plants={data.plants} onChange={setPlant} />
          <label className="text-xs text-foreground">
            Add chart
            <select
              aria-label="Add chart"
              className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-sm"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) commit(pinChart(order, event.target.value));
                event.target.value = "";
              }}
            >
              <option value="">Choose…</option>
              {areasOf(available).map((area) => (
                <optgroup key={area} label={area}>
                  {available
                    .filter((chart) => chart.area === area)
                    .map((chart) => (
                      <option key={chart.id} value={chart.id}>
                        {chart.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      </div>
      {charts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No KPI charts on this page. Add one above, or pin a chart from Quality Objectives & KPIs.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {charts.map((chart) => (
            <div key={chart.id} draggable onDragStart={() => setDragId(chart.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(chart.id)}>
              <KpiChartCard
                chart={chart}
                metrics={data.metrics}
                objectives={data.objectives}
                plants={data.plants}
                plant={plant}
                compact
                pinnedHome={data.layout.home.includes(chart.id)}
                pinnedExecutive={data.layout.executive.includes(chart.id)}
                onPinHome={surface === "executive" ? () => saveOrder({ surface: "home", order: data.layout.home.includes(chart.id) ? unpinChart(data.layout.home, chart.id) : pinChart(data.layout.home, chart.id) }) : undefined}
                onOpen={onOpen ? (metricId, month) => onOpen(metricId, month, plant) : undefined}
                onRemove={() => commit(unpinChart(order, chart.id))}
                onMove={(direction) => commit(moveChart(order, chart.id, direction))}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Every KPI, grouped by area, with pin actions. */
export function KpiCatalog({
  data,
  plant,
  onOpen,
}: {
  data: KpiPayload;
  plant: PlantView;
  onOpen: (metricId: string, month: string) => void;
}) {
  const { saveOrder } = useKpis();
  return (
    <div className="flex flex-col gap-6">
      {areasOf(data.charts).map((area) => (
        <section key={area} className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">{area}</h2>
          <div className="grid gap-3 xl:grid-cols-2">
            {data.charts
              .filter((chart) => chart.area === area)
              .map((chart) => (
                <KpiChartCard
                  key={chart.id}
                  chart={chart}
                  metrics={data.metrics}
                  objectives={data.objectives}
                  plants={data.plants}
                  plant={plant}
                  pinnedHome={data.layout.home.includes(chart.id)}
                  pinnedExecutive={data.layout.executive.includes(chart.id)}
                  onPinHome={() => saveOrder({ surface: "home", order: data.layout.home.includes(chart.id) ? unpinChart(data.layout.home, chart.id) : pinChart(data.layout.home, chart.id) })}
                  onPinExecutive={() =>
                    saveOrder({
                      surface: "executive",
                      order: data.layout.executive.includes(chart.id) ? unpinChart(data.layout.executive, chart.id) : pinChart(data.layout.executive, chart.id),
                    })
                  }
                  onOpen={onOpen}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

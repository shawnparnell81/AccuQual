export type PlantView = number | "all";

export interface KpiPoint {
  month: string;
  all: number | null;
  byPlant: Record<string, number | null>;
}

export interface KpiMetric {
  id: string;
  area: string;
  label: string;
  unit: "count" | "percent" | "days" | "currency";
  direction: "higher" | "lower";
  plantSplit: boolean;
  definition: string;
  note: string | null;
  points: KpiPoint[];
}

export interface KpiChartDef {
  id: string;
  area: string;
  label: string;
  metricId: string;
  compareMetricId: string | null;
}

export interface ObjectiveReading {
  actual: number | null;
  status: "green" | "amber" | "red" | "none";
  percentOfTarget: number | null;
}

export interface KpiObjective {
  id: string;
  name: string;
  metric: string;
  plantScope: "greer" | "wellman" | "all";
  target: number;
  direction: "higher" | "lower";
  amberThreshold: number;
  ownerId: number | null;
  ownerName: string | null;
  reviewFrequency: "monthly" | "quarterly";
  active: boolean;
  notes: string;
  updatedAt: string;
  periodLabel: string;
  readings: { all: ObjectiveReading; byPlant: Record<string, ObjectiveReading> };
}

export interface KpiPlant {
  id: number;
  name: string;
  token: "greer" | "wellman" | null;
}

export interface KpiLayout {
  home: string[];
  executive: string[];
  homeIsDefault: boolean;
  executiveIsDefault: boolean;
}

export interface KpiPayload {
  computedAt: string;
  canEdit: boolean;
  plants: KpiPlant[];
  metrics: KpiMetric[];
  charts: KpiChartDef[];
  objectives: KpiObjective[];
  people: { id: number; name: string }[];
  windows: string[];
  quarter: string;
  layout: KpiLayout;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortMonth(key: string): string {
  const [year, month] = key.split("-");
  const name = MONTHS[Number(month) - 1] ?? key;
  return `${name} ${year?.slice(2) ?? ""}`.trim();
}

export function formatKpiValue(unit: KpiMetric["unit"], value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (unit === "percent") return `${value}%`;
  if (unit === "days") return `${value}d`;
  if (unit === "currency") return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return Number.isInteger(value) ? String(value) : String(value);
}

export function pointValue(point: KpiPoint, plant: PlantView, plantSplit: boolean): number | null {
  if (!plantSplit || plant === "all") return point.all;
  return point.byPlant[String(plant)] ?? null;
}

export function defaultPlantView(plants: KpiPlant[], siteScope: "all" | null, currentSiteId: number | null): PlantView {
  if (siteScope === "all" || currentSiteId == null) return "all";
  const plant = plants.find((item) => item.id === currentSiteId);
  if (!plant || (plant.token !== "greer" && plant.token !== "wellman")) return "all";
  return plant.id;
}

export function objectiveVisible(objective: KpiObjective, plant: PlantView, plants: KpiPlant[]): boolean {
  if (!objective.active) return false;
  if (plant === "all" || objective.plantScope === "all") return true;
  return plants.find((item) => item.id === plant)?.token === objective.plantScope;
}

export function objectiveReading(objective: KpiObjective, plant: PlantView, plants: KpiPlant[]): ObjectiveReading {
  if (plant === "all") {
    if (objective.plantScope === "all") return objective.readings.all;
    const scoped = plants.find((item) => item.token === objective.plantScope);
    return (scoped && objective.readings.byPlant[String(scoped.id)]) || objective.readings.all;
  }
  return objective.readings.byPlant[String(plant)] ?? objective.readings.all;
}

export function summaryFor(objectives: KpiObjective[], plant: PlantView, plants: KpiPlant[]): { onTarget: number; active: number } {
  const visible = objectives.filter((objective) => objectiveVisible(objective, plant, plants));
  return {
    active: visible.length,
    onTarget: visible.filter((objective) => objectiveReading(objective, plant, plants).status === "green").length,
  };
}

export function pinChart(order: string[], id: string): string[] {
  return order.includes(id) ? order : [...order, id];
}

export function unpinChart(order: string[], id: string): string[] {
  return order.filter((item) => item !== id);
}

export function moveChart(order: string[], id: string, direction: -1 | 1): string[] {
  const index = order.indexOf(id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= order.length) return order;
  const copy = [...order];
  const [row] = copy.splice(index, 1);
  copy.splice(next, 0, row!);
  return copy;
}

export function toggleChart(order: string[], id: string): string[] {
  return order.includes(id) ? unpinChart(order, id) : pinChart(order, id);
}

export function targetFor(chart: KpiChartDef, objectives: KpiObjective[], plant: PlantView, plants: KpiPlant[]): number | null {
  if (chart.compareMetricId) return null;
  const matches = objectives.filter((objective) => objective.active && objective.metric === chart.metricId && objectiveVisible(objective, plant, plants));
  const exact = matches.find((objective) => {
    if (plant === "all") return objective.plantScope === "all";
    return plants.find((item) => item.id === plant)?.token === objective.plantScope;
  });
  return (exact ?? matches.find((objective) => objective.plantScope === "all") ?? matches[0])?.target ?? null;
}

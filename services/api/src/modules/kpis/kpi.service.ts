import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { company } from "../../drizzle/schema/company.js";
import { users } from "../../drizzle/schema/users.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { AppError } from "../../utils/appError.js";
import { isFullAccessRole } from "../roles/roleAccess.js";
import { loadKpiSource, loadPeople, loadPlants } from "./kpi.load.js";
import { seriesFor, valueFor, type DrillRow } from "./kpi.compute.js";
import {
  CHARTS,
  METRICS,
  amberIsValid,
  cleanChartOrder,
  defaultOwnerId,
  metricById,
  monthWindow,
  objectiveStatus,
  percentOfTarget,
  plantToken,
  quarterWindow,
  recentMonthWindows,
  resolveChartLayout,
  reviewWindow,
  seedObjectives,
  type PlantScope,
  type StoredObjective,
} from "./kpi.model.js";

type Profile = NonNullable<(typeof company.$inferSelect)["profile"]>;

export interface ObjectiveInput {
  name: string;
  metric: string;
  plantScope: PlantScope;
  target: number;
  direction: "higher" | "lower";
  amberThreshold: number;
  ownerId: number | null;
  reviewFrequency: "monthly" | "quarterly";
  active: boolean;
  notes: string;
}

function storedList(profile: Profile | null): StoredObjective[] | undefined {
  const raw = profile?.qualityObjectives;
  if (raw == null) return undefined;
  return raw.filter((row) => row && typeof row.id === "string" && metricById(row.metric));
}

async function loadCompany(db: Db) {
  const [row] = await db.select().from(company);
  if (!row) throw AppError.notFound("Company");
  return row;
}

async function writeObjectives(db: Db, companyId: number, profile: Profile | null, objectives: StoredObjective[]) {
  const next = { ...(profile ?? {}), qualityObjectives: objectives };
  await db.update(company).set({ profile: next }).where(eq(company.id, companyId));
}

function describe(who: string, verb: string, objective: StoredObjective, detail: string): string {
  return `${who} ${verb} quality objective "${objective.name}". ${detail}`.trim();
}

async function actorName(db: Db, userId: number | undefined): Promise<string> {
  if (!userId) return "Someone";
  const [actor] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return actor?.name?.trim() || "Someone";
}

async function audit(db: Db, companyId: number, userId: number | undefined, objective: StoredObjective, what: string, description: string) {
  await recordAuditTrail(db, {
    entityType: "QualityObjective",
    entityId: companyId,
    action: what === "added" ? "create" : "update",
    changes: {
      who: await actorName(db, userId),
      what,
      when: new Date().toISOString(),
      description,
      objectiveId: objective.id,
      name: objective.name,
      metric: objective.metric,
    },
    performedBy: userId,
  });
}

export async function ensureObjectives(db: Db, now: Date): Promise<StoredObjective[]> {
  const co = await loadCompany(db);
  const existing = storedList(co.profile);
  if (existing) return existing;
  const people = await loadPeople(db);
  const seeded = seedObjectives(defaultOwnerId(people), now);
  await db
    .update(company)
    .set({
      profile: sql`jsonb_set(coalesce(${company.profile}, '{}'::jsonb), '{qualityObjectives}', ${JSON.stringify(seeded)}::jsonb)`,
    })
    .where(and(eq(company.id, co.id), sql`${company.profile}->'qualityObjectives' IS NULL`));
  const saved = storedList((await loadCompany(db)).profile);
  return saved ?? seeded;
}

function assertObjective(input: ObjectiveInput) {
  if (!metricById(input.metric)) throw AppError.badRequest("Choose a metric from the list.");
  if (!input.name.trim()) throw AppError.badRequest("Name the objective.");
  if (!amberIsValid(input.direction, input.target, input.amberThreshold)) {
    throw AppError.badRequest(input.direction === "higher" ? "The amber line has to sit at or below the target." : "The amber line has to sit at or above the target.");
  }
}

export async function saveObjective(db: Db, userId: number | undefined, input: ObjectiveInput, id?: string): Promise<StoredObjective> {
  assertObjective(input);
  const co = await loadCompany(db);
  const list = storedList(co.profile) ?? [];
  const who = await actorName(db, userId);
  const now = new Date().toISOString();
  if (!id) {
    const created: StoredObjective = { ...input, name: input.name.trim(), notes: input.notes.trim(), id: randomUUID(), updatedAt: now, updatedById: userId ?? null };
    await writeObjectives(db, co.id, co.profile, [...list, created]);
    await audit(db, co.id, userId, created, "added", describe(who, "added", created, `Metric ${created.metric}, target ${created.target}, ${created.reviewFrequency}, ${created.plantScope}.`));
    return created;
  }
  const previous = list.find((row) => row.id === id);
  if (!previous) throw AppError.notFound("Objective");
  const next: StoredObjective = { ...previous, ...input, name: input.name.trim(), notes: input.notes.trim(), id, updatedAt: now, updatedById: userId ?? null };
  await writeObjectives(db, co.id, co.profile, list.map((row) => (row.id === id ? next : row)));
  const changes: string[] = [];
  if (previous.name !== next.name) changes.push(`name "${previous.name}" to "${next.name}"`);
  if (previous.target !== next.target) changes.push(`target ${previous.target} to ${next.target}`);
  if (previous.amberThreshold !== next.amberThreshold) changes.push(`amber line ${previous.amberThreshold} to ${next.amberThreshold}`);
  if (previous.direction !== next.direction) changes.push(`direction ${previous.direction} to ${next.direction}`);
  if (previous.plantScope !== next.plantScope) changes.push(`plant ${previous.plantScope} to ${next.plantScope}`);
  if (previous.reviewFrequency !== next.reviewFrequency) changes.push(`review ${previous.reviewFrequency} to ${next.reviewFrequency}`);
  if (previous.ownerId !== next.ownerId) changes.push("owner");
  if (previous.active !== next.active) changes.push(next.active ? "turned back on" : "deactivated");
  if (previous.notes !== next.notes) changes.push("notes");
  if (previous.metric !== next.metric) changes.push(`metric ${previous.metric} to ${next.metric}`);
  await audit(db, co.id, userId, next, next.active ? "updated" : "deactivated", describe(who, next.active ? "updated" : "deactivated", next, changes.length > 0 ? `Changed ${changes.join(", ")}.` : "Saved with no field changes."));
  return next;
}

export async function deactivateObjective(db: Db, userId: number | undefined, id: string): Promise<StoredObjective> {
  const co = await loadCompany(db);
  const list = storedList(co.profile) ?? [];
  const previous = list.find((row) => row.id === id);
  if (!previous) throw AppError.notFound("Objective");
  return saveObjective(db, userId, { ...previous, active: false }, id);
}

export async function buildKpiPayload(db: Db, roleName: string | null | undefined, now = new Date()) {
  const objectives = await ensureObjectives(db, now);
  const [source, plants, people] = await Promise.all([loadKpiSource(db, now), loadPlants(db), loadPeople(db)]);
  const windows = recentMonthWindows(now);
  const plantIds = plants.map((plant) => plant.id);
  const metrics = METRICS.map((metric) => {
    const series = seriesFor(metric.id, source, windows, metric.plantSplit ? plantIds : []);
    const standing = !metric.plantSplit ? series.note : series.note;
    return {
      id: metric.id,
      area: metric.area,
      label: metric.label,
      unit: metric.unit,
      direction: metric.direction,
      plantSplit: metric.plantSplit,
      definition: metric.definition,
      note: standing,
      points: series.points,
    };
  });
  const names = new Map(people.map((person) => [person.id, person.name?.trim() || `Person #${person.id}`]));
  const objectiveViews = objectives.map((objective) => {
    const window = reviewWindow(objective.reviewFrequency, now);
    const metric = metricById(objective.metric);
    const read = (plant: number | "all") => valueFor(objective.metric, source, window, metric?.plantSplit ? plant : "all").value;
    const pack = (actual: number | null) => ({
      actual,
      status: objectiveStatus(actual, objective.target, objective.direction, objective.amberThreshold),
      percentOfTarget: percentOfTarget(actual, objective.target, objective.direction),
    });
    const byPlant: Record<string, ReturnType<typeof pack>> = {};
    if (metric?.plantSplit) {
      for (const plant of plants) byPlant[String(plant.id)] = pack(read(plant.id));
    }
    return {
      ...objective,
      ownerName: objective.ownerId != null ? names.get(objective.ownerId) ?? null : null,
      periodLabel: window.label === window.key ? window.key : window.label,
      readings: { all: pack(read("all")), byPlant },
    };
  });
  return {
    computedAt: now.toISOString(),
    canEdit: isFullAccessRole(roleName),
    plants: plants.map((plant) => ({ id: plant.id, name: plant.name, token: plantToken(plant.name) })),
    metrics,
    charts: CHARTS.map((chart) => ({ id: chart.id, area: chart.area, label: chart.label, metricId: chart.metricId, compareMetricId: chart.compareMetricId ?? null })),
    objectives: objectiveViews,
    people: people.map((person) => ({ id: person.id, name: person.name?.trim() || `Person #${person.id}` })),
    windows: windows.map((window) => window.key),
    quarter: quarterWindow(now).key,
  };
}

export async function recordsFor(db: Db, metric: string, month: string, siteId: number | null, now = new Date()): Promise<{ title: string; siteName: string; total: number; note: string | null; rows: DrillRow[] }> {
  const def = metricById(metric);
  if (!def) throw AppError.badRequest("Choose a metric from the list.");
  const plants = await loadPlants(db);
  const plant = siteId == null ? "all" : siteId;
  if (typeof plant === "number" && !plants.some((row) => row.id === plant)) throw AppError.badRequest("Choose a plant.");
  let window = recentMonthWindows(now).find((item) => item.key === month);
  if (!window && /^\d{4}-\d{2}$/.test(month)) {
    const [year, mon] = month.split("-").map(Number) as [number, number];
    window = monthWindow(year, mon, now);
  }
  if (!window && month === "quarter") window = quarterWindow(now);
  if (!window) throw AppError.badRequest("Choose a month.");
  const source = await loadKpiSource(db, now);
  const result = valueFor(metric, source, window, def.plantSplit ? plant : "all");
  const siteName = plant === "all" ? "All plants" : plants.find((row) => row.id === plant)?.name ?? "Plant";
  return {
    title: `${def.label} — ${siteName}`,
    siteName: def.plantSplit ? siteName : "All plants",
    total: result.rows.length,
    note: result.notes.join(" ") || null,
    rows: result.rows.slice(0, 200),
  };
}

export async function readChartLayout(db: Db, userId: number) {
  const [row] = await db.select({ workspaceLayout: users.workspaceLayout }).from(users).where(eq(users.id, userId));
  return resolveChartLayout(row?.workspaceLayout?.kpiCharts);
}

export async function writeChartLayout(db: Db, userId: number, surface: "home" | "executive", order: string[]) {
  const [row] = await db.select({ workspaceLayout: users.workspaceLayout }).from(users).where(eq(users.id, userId));
  const previous = row?.workspaceLayout ?? {};
  const charts = { ...(previous.kpiCharts ?? {}) };
  const cleaned = cleanChartOrder(order, []);
  if (surface === "home") charts.home = cleaned;
  else charts.executive = cleaned;
  const next = { ...previous, kpiCharts: charts };
  await db.update(users).set({ workspaceLayout: next, updatedAt: new Date() }).where(eq(users.id, userId));
  return resolveChartLayout(charts);
}

export async function resetChartLayout(db: Db, userId: number, surface: "home" | "executive" | "all") {
  const [row] = await db.select({ workspaceLayout: users.workspaceLayout }).from(users).where(eq(users.id, userId));
  const previous = row?.workspaceLayout ?? {};
  const charts = { ...(previous.kpiCharts ?? {}) };
  if (surface === "all" || surface === "home") delete charts.home;
  if (surface === "all" || surface === "executive") delete charts.executive;
  const kpiCharts = charts.home != null || charts.executive != null ? charts : undefined;
  const next = { ...previous, kpiCharts };
  if (!kpiCharts) delete next.kpiCharts;
  await db.update(users).set({ workspaceLayout: next, updatedAt: new Date() }).where(eq(users.id, userId));
  return resolveChartLayout(kpiCharts);
}

export function requireObjectiveEditor(roleName: string | null | undefined) {
  if (!isFullAccessRole(roleName)) throw AppError.forbidden("Only an owner or administrator can change quality objectives.");
}

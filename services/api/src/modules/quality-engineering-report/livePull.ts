import { and, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../../lib/requestDb.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";
import { loadPresentTables } from "../reports/reports.sections.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { scarForms } from "../../drizzle/schema/scarForms.js";
import { fmeaItems } from "../../drizzle/schema/risk.js";
import { quarantineRecords } from "../../drizzle/schema/quarantine.js";
import { documents } from "../../drizzle/schema/documents.js";
import { monthBounds, type Gated, type LivePull, type NcrRow } from "./model.js";

const ACCESS_KEYS = ["ncr", "capa", "quarantine", "fai", "documents", "risk", "scar", "warranty"] as const satisfies readonly ResourceKey[];

export async function engineeringAccess(
  db: Db,
  user: { id: number; roleName: string | null; department: string | null },
): Promise<{ canRead: boolean; canEdit: boolean; level: (resource: ResourceKey) => "none" | "read" | "edit" }> {
  const levels = {} as Record<(typeof ACCESS_KEYS)[number], "none" | "read" | "edit">;
  for (const key of ACCESS_KEYS) {
    levels[key] = (await getUserAccessLevel(db, user, key)) as "none" | "read" | "edit";
  }
  const level = (resource: ResourceKey) => levels[resource as (typeof ACCESS_KEYS)[number]] ?? "none";
  const canRead = ACCESS_KEYS.some((key) => level(key) !== "none");
  const canEdit = ACCESS_KEYS.some((key) => level(key) === "edit");
  return { canRead, canEdit, level };
}

function during(column: PgColumn, start: Date, end: Date): SQL {
  return and(gte(column, start), lt(column, end)) as SQL;
}

function textOf(data: Record<string, unknown> | null, keys: string[]): string {
  if (!data) return "";
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function titleCase(value: string): string {
  if (!value) return "";
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function noAccess<T>(): Gated<T> {
  return { status: "no_access" };
}

function unavailable<T>(reason: string): Gated<T> {
  return { status: "unavailable", reason };
}

export async function pullLive(db: Db, input: {
  year: number;
  month: number;
  siteIds: number[];
  level: (resource: ResourceKey) => "none" | "read" | "edit";
}): Promise<LivePull> {
  const present = await loadPresentTables(db);
  const { start, end } = monthBounds(input.year, input.month);
  const siteIds = input.siteIds;

  const ncrGate = async (): Promise<LivePull["ncr"]> => {
    if (input.level("ncr") === "none") return noAccess();
    if (!present.has("ncr")) return unavailable("The NCR table is not in this database.");
    const where = and(eq(ncr.isDeleted, false), during(ncr.createdAt, start, end), siteIds.length > 0 ? inArray(ncr.siteId, siteIds) : undefined);
    const rows = await db
      .select({ id: ncr.id, title: ncr.title, description: ncr.description, status: ncr.status, processData: ncr.processData })
      .from(ncr)
      .where(where)
      .limit(200);
    const mapped: NcrRow[] = rows.map((row) => {
      const data = row.processData ?? null;
      const closed = row.status === "closed";
      return {
        id: row.id,
        number: textOf(data, ["ncr_number", "ncrNumber"]) || "",
        partNumber: textOf(data, ["part_number", "partNumber"]) || row.title,
        description: row.description?.trim() || textOf(data, ["description", "nonconformanceDescription"]) || row.title,
        disposition: titleCase(textOf(data, ["disposition", "item_disposition", "final_disposition"])),
        status: closed ? "Closed" : "Open",
      };
    });
    const [countRow] = await db
      .select({
        total: sql<number>`count(*)::int`,
        closed: sql<number>`count(*) filter (where ${ncr.status} = 'closed')::int`,
      })
      .from(ncr)
      .where(where);
    const total = Number(countRow?.total ?? mapped.length);
    const closed = Number(countRow?.closed ?? 0);
    const open = Math.max(0, total - closed);
    return { status: "ok", data: { total, open, closed, rows: mapped } };
  };

  const carsGate = async (): Promise<LivePull["cars"]> => {
    const scarLevel = input.level("scar");
    const capaLevel = input.level("capa");
    if (scarLevel === "none" && capaLevel === "none") return noAccess();
    let scar: number | null = null;
    let capaCount: number | null = null;
    if (scarLevel !== "none" && present.has("scar_forms")) {
      const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(scarForms).where(during(scarForms.createdAt, start, end));
      scar = Number(row?.total ?? 0);
    }
    if (capaLevel !== "none" && present.has("capa")) {
      const where = and(during(capa.createdAt, start, end), siteIds.length > 0 ? inArray(capa.siteId, siteIds) : undefined);
      const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(capa).where(where);
      capaCount = Number(row?.total ?? 0);
    }
    if (scar == null && capaCount == null && (scarLevel !== "none" || capaLevel !== "none")) {
      return unavailable("CAPA and supplier corrective action tables are not in this database.");
    }
    return { status: "ok", data: { scar, capa: capaCount } };
  };

  const rpnGate = async (): Promise<LivePull["rpn"]> => {
    if (input.level("risk") === "none") return noAccess();
    if (!present.has("fmea_items")) return unavailable("The FMEA table is not in this database.");
    const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(fmeaItems).where(during(fmeaItems.createdAt, start, end));
    return { status: "ok", data: { count: Number(row?.total ?? 0) } };
  };

  const quarantineGate = async (): Promise<LivePull["quarantine"]> => {
    if (input.level("quarantine") === "none") return noAccess();
    if (!present.has("quarantine_records")) return unavailable("The quarantine table is not in this database.");
    const rows = await db
      .select({
        id: quarantineRecords.id,
        label: quarantineRecords.itemLabel,
        quantity: quarantineRecords.quantity,
        unit: quarantineRecords.unit,
        reason: quarantineRecords.reason,
        status: quarantineRecords.status,
      })
      .from(quarantineRecords)
      .where(during(quarantineRecords.createdAt, start, end))
      .limit(200);
    return {
      status: "ok",
      data: {
        rows: rows.map((row) => ({
          id: row.id,
          label: row.label,
          quantity: `${row.quantity}${row.unit ? ` ${row.unit}` : ""}`,
          reason: row.reason,
          status: titleCase(row.status),
        })),
      },
    };
  };

  const documentsGate = async (category: string): Promise<Gated<{ count: number }>> => {
    if (input.level("documents") === "none") return noAccess();
    if (!present.has("documents")) return unavailable("The documents table is not in this database.");
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(eq(documents.isDeleted, false), eq(documents.category, category), during(documents.createdAt, start, end)));
    return { status: "ok", data: { count: Number(row?.total ?? 0) } };
  };

  const faiGate = async (): Promise<LivePull["fai"]> => {
    // First Article records are retired. Supplier workbook totals still come from the uploaded file.
    return { status: "ok", data: { rows: [], open: 0 } };
  };

  const [ncrResult, cars, rpn, quarantine, productAlertDocuments, recallDocuments, fai] = await Promise.all([
    ncrGate(),
    carsGate(),
    rpnGate(),
    quarantineGate(),
    documentsGate("product-alerts"),
    documentsGate("recalls"),
    faiGate(),
  ]);

  return { ncr: ncrResult, cars, rpn, quarantine, productAlertDocuments, recallDocuments, fai };
}

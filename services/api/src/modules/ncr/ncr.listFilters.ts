import type { Request } from "express";
import { and, isNull, or, sql, type SQL } from "drizzle-orm";
import { ncr } from "../../drizzle/schema/ncr.js";
import type { Db } from "../../lib/requestDb.js";

type Label = "Minor" | "Major" | "Critical";
const ORDER: Label[] = ["Minor", "Major", "Critical"];

/** The NCR form has this classification ticked (the list reads it when the severity column is empty). */
function formTicked(label: Label): SQL {
  const path = `$.ncrClassification.** ? (@.${label} == true)`;
  return sql`exists (select 1 from form_data fd where fd.form_type = 'ncr' and fd.entity_id = ${ncr.id} and jsonb_path_exists(fd.data, ${path}::jsonpath))`;
}

/** First ticked label wins, the same order the list uses. */
function formClassification(label: Label): SQL {
  const earlier = ORDER.slice(0, ORDER.indexOf(label)).map((name) => sql`not ${formTicked(name)}`);
  return and(formTicked(label), ...earlier)!;
}

const LABEL_FOR_SEVERITY: Record<string, Label | null> = { low: "Minor", medium: null, high: "Major", critical: "Critical" };

/** The severity bucket the list shows: the severity column, else the form's classification. */
export function listedSeverityIs(severity: string): SQL | undefined {
  if (!(severity in LABEL_FOR_SEVERITY)) return undefined;
  const label = LABEL_FOR_SEVERITY[severity];
  const direct = sql`${ncr.severity} = ${severity}`;
  return label ? or(direct, and(isNull(ncr.severity), formClassification(label))) : direct;
}

export function ncrListFilters(req: Request): (SQL | undefined)[] {
  const severity = typeof req.query.severity === "string" ? req.query.severity : "";
  return severity ? [listedSeverityIs(severity) ?? sql`false`] : [];
}

/** The NCR summary cards over every matching row, not just the loaded page. */
export async function ncrListCounts(db: Db, where: SQL | undefined): Promise<Record<string, number>> {
  const severe = or(listedSeverityIs("high"), listedSeverityIs("critical"))!;
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${ncr.status} <> 'closed')::int`,
      severe: sql<number>`count(*) filter (where ${severe})::int`,
      overdue: sql<number>`count(*) filter (where ${ncr.status} <> 'closed' and ${ncr.dueDate} < now())::int`,
    })
    .from(ncr)
    .where(where);
  return { open: row?.open ?? 0, severe: row?.severe ?? 0, overdue: row?.overdue ?? 0 };
}

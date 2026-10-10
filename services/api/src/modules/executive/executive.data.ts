import { sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { checkedOptions } from "../quality-automation/logic.js";
import { optionalRows } from "../sites/optionalSql.js";

export interface Fact {
  group: "ncr" | "capa" | "audit" | "complaint" | "warranty" | "fai";
  siteId: number | null;
  createdAt: Date | null;
  dueAt: Date | null;
  status: string;
  statusLabel: string;
  recordNumber: string | null;
  title: string;
  href: string | null;
  outcome: "open" | "pass" | "fail" | "closed";
  categories: string[];
  overdue: boolean;
}

const NCR_STATUS: Record<string, string> = {
  ncr_created: "NCR created",
  open: "Open",
  contain: "Contain",
  containment: "Contain",
  disposition: "Disposition",
  investigating: "Investigating",
  corrective_action: "Corrective action",
  fix: "Fix",
  verify: "Verify",
  closed: "Closed",
};

const CAPA_STATUS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  verifying: "Verifying",
  closed: "Closed",
};

function asDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function labelStatus(map: Record<string, string>, status: string): string {
  return map[status] ?? status.replace(/_/g, " ");
}

function categoriesFromForm(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const form = data as Record<string, unknown>;
  return checkedOptions(form.nonconformanceCategory, "category");
}

function faiOutcome(status: string, failure: string | null, closed: boolean, blob: string): "open" | "pass" | "fail" {
  const folded = `${status} ${failure ?? ""}`.toLowerCase();
  const failed = folded.includes("fail") || folded.includes("reject") || failure?.toLowerCase() === "yes" || blob.toLowerCase().includes('"failed"');
  if (failed) return "fail";
  const passed = closed || folded.includes("approv") || folded.includes("pass") || folded.includes("closed") || blob.toLowerCase().includes('"passed"');
  return passed ? "pass" : "open";
}

async function rowsOf<T extends Record<string, unknown>>(db: Db, statement: ReturnType<typeof sql>): Promise<T[]> {
  return (await optionalRows<T>(db, statement)) ?? [];
}

export async function loadFacts(db: Db, now: Date): Promise<Fact[]> {
  const facts: Fact[] = [];

  const ncrs = await rowsOf<{
    id: number;
    site_id: number | null;
    status: string;
    record_number: string | null;
    title: string | null;
    created_at: Date | string | null;
    due_date: Date | string | null;
    form: unknown;
  }>(db, sql`
    SELECT n.id, n.site_id, n.status, n.record_number, n.title, n.created_at, n.due_date, f.data AS form
    FROM ncr n
    LEFT JOIN LATERAL (
      SELECT data FROM form_data
      WHERE entity_type = 'ncr' AND entity_id = n.id AND form_type = 'ncr'
      ORDER BY id DESC
      LIMIT 1
    ) f ON true
    WHERE n.is_deleted = false
  `);
  for (const row of ncrs) {
    const dueAt = asDate(row.due_date);
    const outcome = row.status === "closed" ? "closed" : "open";
    facts.push({
      group: "ncr",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt,
      status: row.status,
      statusLabel: labelStatus(NCR_STATUS, row.status),
      recordNumber: text(row.record_number),
      title: text(row.title) ?? "NCR",
      href: `/ncr/${row.id}`,
      outcome,
      categories: categoriesFromForm(row.form),
      overdue: outcome === "open" && dueAt != null && dueAt.getTime() < now.getTime(),
    });
  }

  const capas = await rowsOf<{
    id: number;
    site_id: number | null;
    status: string;
    record_number: string | null;
    created_at: Date | string | null;
    due_date: Date | string | null;
  }>(db, sql`SELECT id, site_id, status, record_number, created_at, due_date FROM capa`);
  for (const row of capas) {
    const dueAt = asDate(row.due_date);
    const outcome = row.status === "closed" ? "closed" : "open";
    facts.push({
      group: "capa",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt,
      status: row.status,
      statusLabel: labelStatus(CAPA_STATUS, row.status),
      recordNumber: text(row.record_number),
      title: "CAPA",
      href: `/capa/${row.id}`,
      outcome,
      categories: [],
      overdue: outcome === "open" && dueAt != null && dueAt.getTime() < now.getTime(),
    });
  }

  const audits = await rowsOf<{
    id: number;
    site_id: number | null;
    status: string;
    record_number: string | null;
    name: string | null;
    created_at: Date | string | null;
    scheduled_at: Date | string | null;
  }>(db, sql`SELECT id, site_id, status, record_number, name, created_at, scheduled_at FROM audits`);
  for (const row of audits) {
    const dueAt = asDate(row.scheduled_at);
    const outcome = row.status === "completed" ? "closed" : "open";
    facts.push({
      group: "audit",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt,
      status: row.status,
      statusLabel: labelStatus({ scheduled: "Scheduled", in_progress: "In progress", completed: "Completed" }, row.status),
      recordNumber: text(row.record_number),
      title: text(row.name) ?? "Audit",
      href: `/audits/${row.id}`,
      outcome,
      categories: [],
      overdue: outcome === "open" && dueAt != null && dueAt.getTime() < now.getTime(),
    });
  }

  const complaints = await rowsOf<{
    id: number;
    site_id: number | null;
    status: string;
    record_number: string | null;
    customer_name: string | null;
    description: string | null;
    created_at: Date | string | null;
  }>(db, sql`SELECT id, site_id, status, record_number, customer_name, description, created_at FROM complaints`);
  for (const row of complaints) {
    const outcome = row.status === "closed" || row.status === "resolved" ? "closed" : "open";
    facts.push({
      group: "complaint",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: row.status,
      statusLabel: labelStatus({ open: "Open", investigating: "Investigating", resolved: "Resolved", closed: "Closed" }, row.status),
      recordNumber: text(row.record_number),
      title: text(row.customer_name) ?? text(row.description) ?? "Customer complaint",
      href: `/complaints/${row.id}`,
      outcome,
      categories: [],
      overdue: false,
    });
  }

  const isoComplaints = await rowsOf<{ id: number; site_id: number | null; record_number: string | null; created_at: Date | string | null }>(
    db,
    sql`SELECT id, site_id, record_number, created_at FROM iso_quality_forms WHERE form_type ILIKE '%complaint%'`,
  );
  const qmsComplaints = await rowsOf<{ id: number; site_id: number | null; record_number: string | null; created_at: Date | string | null }>(
    db,
    sql`SELECT id, site_id, form_no AS record_number, created_at FROM qms_forms WHERE form_type ILIKE '%complaint%' AND status IS DISTINCT FROM 'obsolete'`,
  );
  const filedComplaints = await rowsOf<{ id: number; site_id: number | null; record_number: string | null; title: string | null; created_at: Date | string | null }>(
    db,
    sql`
      SELECT f.id, n.site_id, n.record_number, n.title, f.created_at
      FROM form_data f
      LEFT JOIN ncr n ON f.entity_type = 'ncr' AND f.entity_id = n.id
      WHERE f.form_type = 'complaint'
    `,
  );
  for (const row of [...isoComplaints, ...qmsComplaints, ...filedComplaints.map((item) => ({ ...item }))]) {
    const filed = "title" in row;
    facts.push({
      group: "complaint",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: "open",
      statusLabel: "Open",
      recordNumber: text(row.record_number),
      title: filed ? text((row as { title?: string | null }).title) ?? "Customer complaint" : "Customer complaint",
      href: null,
      outcome: "open",
      categories: [],
      overdue: false,
    });
  }

  const claims = await rowsOf<{
    id: number;
    site_id: number | null;
    status: string;
    claim_number: string | null;
    failure_description: string | null;
    created_at: Date | string | null;
  }>(db, sql`SELECT id, site_id, status, claim_number, failure_description, created_at FROM warranty_claims`);
  for (const row of claims) {
    const outcome = row.status === "closed" || row.status === "rejected" ? "closed" : "open";
    facts.push({
      group: "warranty",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: row.status,
      statusLabel: labelStatus({}, row.status),
      recordNumber: text(row.claim_number),
      title: text(row.failure_description) ?? "Warranty claim",
      href: `/warranty/${row.id}`,
      outcome,
      categories: [],
      overdue: false,
    });
  }

  const isoWarranty = await rowsOf<{ id: number; site_id: number | null; record_number: string | null; created_at: Date | string | null }>(
    db,
    sql`SELECT id, site_id, record_number, created_at FROM iso_quality_forms WHERE form_type ILIKE '%warranty%'`,
  );
  const qmsWarranty = await rowsOf<{ id: number; site_id: number | null; record_number: string | null; created_at: Date | string | null }>(
    db,
    sql`SELECT id, site_id, form_no AS record_number, created_at FROM qms_forms WHERE form_type ILIKE '%warranty%' AND status IS DISTINCT FROM 'obsolete'`,
  );
  for (const row of [...isoWarranty, ...qmsWarranty]) {
    facts.push({
      group: "warranty",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: "open",
      statusLabel: "Open",
      recordNumber: text(row.record_number),
      title: "Warranty claim",
      href: null,
      outcome: "open",
      categories: [],
      overdue: false,
    });
  }

  const validations = await rowsOf<{
    id: number;
    site_id: number | null;
    record_number: string | null;
    created_at: Date | string | null;
    data: unknown;
  }>(db, sql`SELECT id, site_id, record_number, created_at, data FROM validation_reports`);
  for (const row of validations) {
    const blob = JSON.stringify(row.data ?? {});
    const outcome = faiOutcome("", null, false, blob);
    facts.push({
      group: "fai",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: outcome,
      statusLabel: outcome === "pass" ? "Pass" : outcome === "fail" ? "Fail" : "Open",
      recordNumber: text(row.record_number),
      title: "Validation report",
      href: `/validation-reports/${row.id}`,
      outcome,
      categories: [],
      overdue: false,
    });
  }

  const csas = await rowsOf<{
    id: number;
    site_id: number | null;
    number: string | null;
    status: string;
    failure_detected: string | null;
    date_closed: Date | string | null;
    part_description: string | null;
    created_at: Date | string | null;
  }>(db, sql`SELECT id, site_id, number, status, failure_detected, date_closed, part_description, created_at FROM csa_fai_records`);
  for (const row of csas) {
    const outcome = faiOutcome(row.status ?? "", text(row.failure_detected), asDate(row.date_closed) != null, "");
    facts.push({
      group: "fai",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: outcome,
      statusLabel: outcome === "pass" ? "Pass" : outcome === "fail" ? "Fail" : "Open",
      recordNumber: text(row.number),
      title: text(row.part_description) ?? "CSA first article",
      href: null,
      outcome,
      categories: [],
      overdue: false,
    });
  }

  const pumps = await rowsOf<{
    id: number;
    site_id: number | null;
    number: string | null;
    status: string;
    failure_detected: string | null;
    date_closed: Date | string | null;
    part_description: string | null;
    created_at: Date | string | null;
  }>(db, sql`SELECT id, site_id, fai_number AS number, status, failure_detected, date_closed, part_description, created_at FROM fuel_pump_fai_records`);
  for (const row of pumps) {
    const outcome = faiOutcome(row.status ?? "", text(row.failure_detected), asDate(row.date_closed) != null, "");
    facts.push({
      group: "fai",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: outcome,
      statusLabel: outcome === "pass" ? "Pass" : outcome === "fail" ? "Fail" : "Open",
      recordNumber: text(row.number),
      title: text(row.part_description) ?? "Fuel pump first article",
      href: null,
      outcome,
      categories: [],
      overdue: false,
    });
  }

  return facts;
}

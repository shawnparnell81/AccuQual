import { sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { checkedOptions } from "../quality-automation/logic.js";
import { optionalRows } from "../sites/optionalSql.js";

export interface Fact {
  group: "ncr" | "capa" | "audit" | "complaint" | "warranty" | "fai" | "labor" | "eightd";
  /** Permission key for the page this row opens. Null when the row has no page. */
  module: string | null;
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
      module: "ncr",
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
      module: "capa",
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
      module: "audit",
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
      module: "complaints",
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
  for (const row of isoComplaints) {
    facts.push({
      group: "complaint",
      module: "documents",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: "open",
      statusLabel: "Open",
      recordNumber: text(row.record_number),
      title: "Customer complaint",
      href: `/iso-forms/record/${row.id}`,
      outcome: "open",
      categories: [],
      overdue: false,
    });
  }
  const qmsComplaints = await rowsOf<{ id: number; site_id: number | null; form_type: string; record_number: string | null; created_at: Date | string | null }>(
    db,
    sql`SELECT id, site_id, form_type, form_no AS record_number, created_at FROM qms_forms WHERE form_type ILIKE '%complaint%' AND status IS DISTINCT FROM 'obsolete'`,
  );
  for (const row of qmsComplaints) {
    facts.push({
      group: "complaint",
      module: "qms_forms",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: "open",
      statusLabel: "Open",
      recordNumber: text(row.record_number),
      title: "Customer complaint",
      href: `/qms-forms/${encodeURIComponent(row.form_type)}/${row.id}`,
      outcome: "open",
      categories: [],
      overdue: false,
    });
  }
  const filedComplaints = await rowsOf<{
    id: number;
    entity_type: string | null;
    entity_id: number | null;
    site_id: number | null;
    record_number: string | null;
    title: string | null;
    created_at: Date | string | null;
  }>(
    db,
    sql`
      SELECT f.id, f.entity_type, f.entity_id, n.site_id, n.record_number, n.title, f.created_at
      FROM form_data f
      LEFT JOIN ncr n ON f.entity_type = 'ncr' AND f.entity_id = n.id
      WHERE f.form_type = 'complaint'
    `,
  );
  for (const row of filedComplaints) {
    const ncrId = row.entity_type === "ncr" && row.entity_id != null ? Number(row.entity_id) : null;
    facts.push({
      group: "complaint",
      module: ncrId == null ? null : "ncr",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: "open",
      statusLabel: "Open",
      recordNumber: text(row.record_number),
      title: text(row.title) ?? "Customer complaint",
      href: ncrId == null ? null : `/ncr/${ncrId}`,
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
      module: "warranty",
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
  for (const row of isoWarranty) {
    facts.push({
      group: "warranty",
      module: "documents",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: "open",
      statusLabel: "Open",
      recordNumber: text(row.record_number),
      title: "Warranty claim",
      href: `/iso-forms/record/${row.id}`,
      outcome: "open",
      categories: [],
      overdue: false,
    });
  }
  const qmsWarranty = await rowsOf<{ id: number; site_id: number | null; form_type: string; record_number: string | null; created_at: Date | string | null }>(
    db,
    sql`SELECT id, site_id, form_type, form_no AS record_number, created_at FROM qms_forms WHERE form_type ILIKE '%warranty%' AND status IS DISTINCT FROM 'obsolete'`,
  );
  for (const row of qmsWarranty) {
    facts.push({
      group: "warranty",
      module: "qms_forms",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: "open",
      statusLabel: "Open",
      recordNumber: text(row.record_number),
      title: "Warranty claim",
      href: `/qms-forms/${encodeURIComponent(row.form_type)}/${row.id}`,
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
    const kind = validationKind(row.data);
    facts.push({
      group: "fai",
      module: "documents",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: outcome,
      statusLabel: outcome === "pass" ? "Pass" : outcome === "fail" ? "Fail" : "In progress",
      recordNumber: text(row.record_number),
      title: VALIDATION_TITLES[kind] ?? "Validation report",
      href: `/validation-reports/${row.id}`,
      outcome,
      categories: [],
      overdue: false,
    });
  }

  const firstArticles = await rowsOf<{
    id: number;
    site_id: number | null;
    record_number: string | null;
    created_at: Date | string | null;
    data: unknown;
  }>(db, sql`SELECT id, site_id, record_number, created_at, data FROM iso_quality_forms WHERE form_type = 'first_article'`);
  for (const row of firstArticles) {
    const blob = JSON.stringify(row.data ?? {});
    const outcome = faiOutcome("", null, false, blob);
    facts.push({
      group: "fai",
      module: "documents",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: outcome,
      statusLabel: outcome === "pass" ? "Pass" : outcome === "fail" ? "Fail" : "In progress",
      recordNumber: text(row.record_number),
      title: "First Article Inspection",
      href: `/iso-forms/record/${row.id}`,
      outcome,
      categories: [],
      overdue: false,
    });
  }

  const labor = await rowsOf<{
    id: number;
    site_id: number | null;
    status: string;
    claim_number: string | null;
    customer_name: string | null;
    part_name: string | null;
    created_at: Date | string | null;
  }>(db, sql`SELECT id, site_id, status, claim_number, customer_name, part_name, created_at FROM labor_claims`);
  for (const row of labor) {
    const outcome = row.status === "closed" || row.status === "denied" ? "closed" : "open";
    facts.push({
      group: "labor",
      module: "labor_claims",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: row.status,
      statusLabel: labelStatus({ open: "Open", pending: "Pending", approved: "Approved", denied: "Denied", closed: "Closed" }, row.status),
      recordNumber: text(row.claim_number),
      title: text(row.part_name) ?? text(row.customer_name) ?? "Labor claim",
      href: `/labor-claims/${row.id}`,
      outcome,
      categories: [],
      overdue: false,
    });
  }

  const eight = await rowsOf<{
    id: number;
    site_id: number | null;
    record_number: string | null;
    current_step: number | null;
    title: string | null;
    created_at: Date | string | null;
  }>(
    db,
    sql`
      SELECT e.id, n.site_id, e.record_number, e.current_step, n.title, e.created_at
      FROM eight_d e
      LEFT JOIN ncr n ON n.id = e.ncr_id
    `,
  );
  for (const row of eight) {
    const step = row.current_step == null ? 1 : Number(row.current_step);
    const outcome = step >= 8 ? "closed" : "open";
    facts.push({
      group: "eightd",
      module: "eight_d",
      siteId: row.site_id == null ? null : Number(row.site_id),
      createdAt: asDate(row.created_at),
      dueAt: null,
      status: outcome === "closed" ? "closed" : "in_progress",
      statusLabel: outcome === "closed" ? "Closed" : `D${Math.min(8, Math.max(1, step))}`,
      recordNumber: text(row.record_number),
      title: text(row.title) ?? "8D report",
      href: `/8d/${row.id}`,
      outcome,
      categories: [],
      overdue: false,
    });
  }

  return facts;
}

const VALIDATION_TITLES: Record<string, string> = {
  csa: "CSA Validation",
  fuel_pump: "Fuel Pump Validation",
  air_strut: "Air Strut Validation",
  air_spring: "Air Spring Validation",
  fuel_injector: "Fuel Injector Validation",
  brake_wear: "Brake Wear Sensor Validation",
  shock: "Shock Validation",
  air_compressor: "Air Compressor Validation",
  electric_lift: "Electric Lift Support Validation",
  gas_lift: "Gas Lift Support Validation",
  coil_spring: "Coil Spring Validation",
};

function validationKind(data: unknown): string {
  const raw = data && typeof data === "object" ? (data as { formType?: unknown }).formType : undefined;
  return typeof raw === "string" && VALIDATION_TITLES[raw] ? raw : "csa";
}

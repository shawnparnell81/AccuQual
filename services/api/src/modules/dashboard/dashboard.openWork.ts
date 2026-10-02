/**
 * Open quality work for the signed-in dashboard.
 * Pure: the caller already loaded the rows this person is allowed to read.
 * A module they cannot read is left out. Counts stay at zero when the table
 * exists and is empty. Nothing here invents a module or a status.
 *
 * "Open" uses the status each table already stores. Validation, first-article,
 * and TRP sheets have no status column. A sheet with a real approving
 * signature is finished once that signature is present. A sheet with no
 * signature block stays listed, because the form has no close step.
 */

const DAY_MS = 86_400_000;
const RECORD_LIMIT = 300;

const SIGNED_VALIDATION = new Set(["air_strut", "air_spring", "fuel_injector", "brake_wear", "air_compressor", "electric_lift", "gas_lift", "coil_spring"]);

const VALIDATION_TITLE: Record<string, string> = {
  csa: "CSA validation report",
  fuel_pump: "Fuel pump validation",
  air_strut: "Air strut validation",
  air_spring: "Air spring validation",
  fuel_injector: "Fuel injector validation",
  brake_wear: "Brake wear sensor validation",
  shock: "Shock validation report",
  air_compressor: "Air compressor validation",
  electric_lift: "Electric lift support validation",
  gas_lift: "Gas lift support validation",
  coil_spring: "Coil spring validation",
};

const ECR_STATUSES = ["request", "review", "approved", "rejected", "implement", "closed"] as const;
const ECR_DONE = new Set(["closed", "rejected"]);

export interface OpenWorkCard {
  key: string;
  label: string;
  value: number;
  foot: string;
  href: string | null;
  /** Table module this card narrows to. Empty when the card covers more than one list. */
  module: string | null;
  /**
   * Table modules this card narrows to when `module` is empty.
   * The dashboard filters the open-records table to these keys.
   */
  modules?: string[] | null;
}

export interface OpenWorkRecord {
  id: string;
  module: string;
  href: string;
  number: string;
  title: string;
  status: string;
  plantId: number | null;
  plant: string | null;
  /** Null when this module has no owner column. "Unassigned" when the column is empty. */
  owner: string | null;
  updatedAt: string | null;
  ageDays: number | null;
}

export interface OpenWorkModule {
  key: string;
  label: string;
}

export interface OpenWork {
  cards: OpenWorkCard[];
  modules: OpenWorkModule[];
  plants: { id: number; name: string }[];
  records: OpenWorkRecord[];
  /** True when the table kept only the oldest rows. Card counts still include the rest. */
  truncated: boolean;
}

export interface OpenWorkAccess {
  ncr: boolean;
  capa: boolean;
  scar: boolean;
  documents: boolean;
  change: boolean;
  ppap: boolean;
  risk: boolean;
  workOrders: boolean;
  calibration: boolean;
  training: boolean;
}

export interface OpenStamp {
  id: number;
  createdAt: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface OpenNcr extends OpenStamp {
  siteId: number | null;
  title: string;
  status: string;
  severity: string | null;
  assignedTo: number | null;
  isDeleted: boolean;
}

export interface OpenCapa extends OpenStamp {
  siteId: number | null;
  ncrId: number | null;
  status: string;
  ownerId: number | null;
  actionPlan: string | null;
  rootCause: string | null;
}

export interface OpenScar extends OpenStamp {
  status: string;
  scarNumber: string | null;
  supplierName: string | null;
  partNumberDescription: string | null;
  defectDescription: string | null;
  correctiveActionOwner: string | null;
  createdBy: number | null;
}

export interface OpenChange extends OpenStamp {
  title: string;
  status: string;
  requestedBy: number | null;
}

export interface OpenPpap extends OpenStamp {
  partNumber: string;
  partName: string | null;
  status: string;
  ownerId: number | null;
}

export interface OpenRisk extends OpenStamp {
  title: string;
  status: string;
  ownerId: number | null;
}

export interface OpenWorkOrder extends OpenStamp {
  status: string;
  notes: string | null;
  createdBy: number | null;
  sku: string | null;
  description: string | null;
}

export interface OpenForm extends OpenStamp {
  formType: string;
  data: unknown;
}

export interface OpenAssignment {
  status: string;
  userId: number;
  dueAt: Date | string | null;
}

export interface OpenEquipment {
  dueStatus: "failed" | "overdue" | "due_soon" | "upcoming" | "current" | "uncalibrated";
}

export interface OpenWorkInput {
  now: Date;
  allPlants: boolean;
  siteIds: number[];
  sites: { id: number; name: string }[];
  access: OpenWorkAccess;
  names: Record<number, string | null>;
  userSites: { userId: number; siteId: number }[];
  ncrs: OpenNcr[];
  capas: OpenCapa[];
  scars: OpenScar[];
  changes: OpenChange[];
  ppaps: OpenPpap[];
  risks: OpenRisk[];
  workOrders: OpenWorkOrder[];
  validation: OpenForm[];
  forms: OpenForm[];
  assignments: OpenAssignment[];
  equipment: OpenEquipment[];
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function iso(value: Date | string | null | undefined): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function ageDays(value: Date | string | null | undefined, now: Date): number | null {
  const date = toDate(value);
  if (!date) return null;
  const days = Math.floor((now.getTime() - date.getTime()) / DAY_MS);
  return days < 0 ? 0 : days;
}

function inScope(siteId: number | null, siteIds: number[]): boolean {
  return siteId != null && siteIds.includes(siteId);
}

function personName(names: Record<number, string | null>, id: number | null): string {
  if (id == null) return "Unassigned";
  const name = names[id];
  if (name && name.trim()) return name.trim();
  return `Person #${id}`;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function field(data: unknown, key: string): string {
  if (!data || typeof data !== "object") return "";
  return textOf((data as Record<string, unknown>)[key]);
}

function cell(data: unknown, addr: string): string {
  if (!data || typeof data !== "object") return "";
  const cells = (data as { cells?: unknown }).cells;
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) return "";
  return textOf((cells as Record<string, unknown>)[addr]);
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 140) return clean;
  return `${clean.slice(0, 139)}…`;
}

function validationKind(data: unknown): string {
  const raw = data && typeof data === "object" ? (data as { formType?: unknown }).formType : undefined;
  if (typeof raw === "string" && VALIDATION_TITLE[raw]) return raw;
  return "csa";
}

function validationOpen(data: unknown): boolean {
  const kind = validationKind(data);
  if (!SIGNED_VALIDATION.has(kind)) return true;
  return field(data, "authorizedSignature") === "";
}

function ecrStatus(data: unknown): string | null {
  const workflow = data && typeof data === "object" ? (data as { workflow?: unknown }).workflow : undefined;
  const raw = workflow && typeof workflow === "object" ? (workflow as { status?: unknown }).status : undefined;
  const status = typeof raw === "string" && (ECR_STATUSES as readonly string[]).includes(raw) ? raw : "request";
  return ECR_DONE.has(status) ? null : status;
}

function usersAt(userSites: OpenWorkInput["userSites"], siteIds: number[]): Set<number> {
  const wanted = new Set(siteIds);
  const ids = new Set<number>();
  for (const row of userSites) if (wanted.has(row.siteId)) ids.add(row.userId);
  return ids;
}

function daysUntil(value: Date | string | null | undefined, now: Date): number | null {
  const date = toDate(value);
  if (!date) return null;
  return Math.floor((date.getTime() - now.getTime()) / DAY_MS);
}

function assignmentOverdue(row: OpenAssignment, now: Date): boolean {
  if (row.status === "completed") return false;
  if (row.status === "overdue") return true;
  if (row.dueAt == null) return false;
  const days = daysUntil(row.dueAt, now);
  return days != null && days < 0;
}

function companyNote(allPlants: boolean, foot: string): string {
  if (allPlants) return foot;
  return foot ? `${foot} · Company-wide` : "Company-wide";
}

interface Built {
  records: OpenWorkRecord[];
  modules: OpenWorkModule[];
}

function pushRecord(records: OpenWorkRecord[], row: Omit<OpenWorkRecord, "ageDays" | "updatedAt" | "plant"> & { createdAt: Date | string | null; updatedAt?: Date | string | null }, now: Date, plantName: Map<number, string>) {
  const plant = row.plantId == null ? null : plantName.get(row.plantId) ?? `Plant #${row.plantId}`;
  records.push({
    id: row.id,
    module: row.module,
    href: row.href,
    number: row.number,
    title: clip(row.title),
    status: row.status,
    plantId: row.plantId,
    plant,
    owner: row.owner,
    updatedAt: iso(row.updatedAt ?? row.createdAt),
    ageDays: ageDays(row.createdAt, now),
  });
}

function buildRecords(input: OpenWorkInput): Built {
  const { access, now, names } = input;
  const records: OpenWorkRecord[] = [];
  const modules: OpenWorkModule[] = [];
  const plantName = new Map(input.sites.map((site) => [site.id, site.name]));

  if (access.ncr) {
    modules.push({ key: "NCR", label: "NCR" });
    for (const row of input.ncrs) {
      if (row.isDeleted || row.status === "closed" || !inScope(row.siteId, input.siteIds)) continue;
      pushRecord(records, {
        id: `ncr-${row.id}`,
        module: "NCR",
        href: `/ncr/${row.id}`,
        number: `NCR-${row.id}`,
        title: row.title.trim() || `Issue #${row.id}`,
        status: row.status,
        plantId: row.siteId,
        owner: personName(names, row.assignedTo),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }, now, plantName);
    }
  }

  if (access.capa) {
    modules.push({ key: "CAPA", label: "CAPA" });
    for (const row of input.capas) {
      if (row.status === "closed" || !inScope(row.siteId, input.siteIds)) continue;
      const text = row.actionPlan?.trim() || row.rootCause?.trim();
      pushRecord(records, {
        id: `capa-${row.id}`,
        module: "CAPA",
        href: `/capa/${row.id}`,
        number: `CAPA-${row.id}`,
        title: text || (row.ncrId ? `Fix for issue #${row.ncrId}` : `Fix #${row.id}`),
        status: row.status,
        plantId: row.siteId,
        owner: personName(names, row.ownerId),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }, now, plantName);
    }
  }

  if (access.scar) {
    modules.push({ key: "CAR", label: "CAR" });
    for (const row of input.scars) {
      if (row.status === "closed") continue;
      const title = row.partNumberDescription?.trim() || row.defectDescription?.trim() || row.supplierName?.trim() || "Supplier corrective action";
      const ownerText = row.correctiveActionOwner?.trim();
      pushRecord(records, {
        id: `scar-${row.id}`,
        module: "CAR",
        href: `/scar-forms/${row.id}`,
        number: row.scarNumber?.trim() || `SCAR-${row.id}`,
        title,
        status: row.status,
        plantId: null,
        owner: ownerText || personName(names, row.createdBy),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }, now, plantName);
    }
  }

  if (access.documents) {
    modules.push({ key: "VAL", label: "VAL" }, { key: "FAI", label: "FAI" }, { key: "TRP", label: "TRP" }, { key: "ECR", label: "ECR" });
    for (const row of input.validation) {
      if (!validationOpen(row.data)) continue;
      const kind = validationKind(row.data);
      pushRecord(records, {
        id: `val-${row.id}`,
        module: "VAL",
        href: `/validation-reports/${row.id}`,
        number: `VAL-${row.id}`,
        title: VALIDATION_TITLE[kind] ?? "Validation report",
        status: "in_progress",
        plantId: null,
        owner: null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }, now, plantName);
    }
    for (const row of input.forms) {
      if (row.formType === "first_article") {
        const title = cell(row.data, "F3") || cell(row.data, "D4") || "First article inspection";
        pushRecord(records, {
          id: `fai-${row.id}`,
          module: "FAI",
          href: `/iso-forms/record/${row.id}`,
          number: `FAI-${row.id}`,
          title,
          status: "in_progress",
          plantId: null,
          owner: null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }, now, plantName);
        continue;
      }
      if (row.formType === "salt_spray" || row.formType === "prototype_strut") {
        const approved = row.formType === "salt_spray" ? field(row.data, "approvedSignature") : field(row.data, "engineeringSignoffSignature");
        if (approved) continue;
        const tested = row.formType === "salt_spray" && field(row.data, "testedSignature") !== "";
        const title = row.formType === "salt_spray" ? cell(row.data, "B6") || cell(row.data, "B5") || "Salt spray test report" : cell(row.data, "B8") || cell(row.data, "D8") || "Prototype evaluation";
        pushRecord(records, {
          id: `trp-${row.id}`,
          module: "TRP",
          href: `/iso-forms/record/${row.id}`,
          number: `TRP-${row.id}`,
          title,
          status: tested ? "tested" : "in_progress",
          plantId: null,
          owner: null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }, now, plantName);
        continue;
      }
      if (row.formType === "engineering_change") {
        const status = ecrStatus(row.data);
        if (!status) continue;
        const part = cell(row.data, "B6");
        const job = cell(row.data, "B7");
        const title = [part, job].filter(Boolean).join(" · ") || "Engineering change request";
        pushRecord(records, {
          id: `ecr-${row.id}`,
          module: "ECR",
          href: `/iso-forms/record/${row.id}`,
          number: `ECR-${row.id}`,
          title,
          status,
          plantId: null,
          owner: null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }, now, plantName);
      }
    }
  }

  if (access.change) {
    modules.push({ key: "Change", label: "Change" });
    for (const row of input.changes) {
      if (row.status === "implemented" || row.status === "rejected") continue;
      pushRecord(records, {
        id: `chg-${row.id}`,
        module: "Change",
        href: `/change/${row.id}`,
        number: `CHG-${row.id}`,
        title: row.title.trim() || `Change request #${row.id}`,
        status: row.status,
        plantId: null,
        owner: personName(names, row.requestedBy),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }, now, plantName);
    }
  }

  if (access.ppap) {
    modules.push({ key: "PPAP", label: "PPAP" });
    for (const row of input.ppaps) {
      if (row.status !== "open" && row.status !== "submitted") continue;
      const title = [row.partNumber.trim(), row.partName?.trim() ?? ""].filter(Boolean).join(" — ") || `PPAP #${row.id}`;
      pushRecord(records, {
        id: `ppap-${row.id}`,
        module: "PPAP",
        href: `/ppap/${row.id}`,
        number: `PPAP-${row.id}`,
        title,
        status: row.status,
        plantId: null,
        owner: personName(names, row.ownerId),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }, now, plantName);
    }
  }

  if (access.risk) {
    modules.push({ key: "Risk", label: "Risk" });
    for (const row of input.risks) {
      if (row.status === "closed") continue;
      pushRecord(records, {
        id: `risk-${row.id}`,
        module: "Risk",
        href: `/risk/${row.id}`,
        number: `RISK-${row.id}`,
        title: row.title.trim() || `Risk #${row.id}`,
        status: row.status,
        plantId: null,
        owner: personName(names, row.ownerId),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }, now, plantName);
    }
  }

  if (access.workOrders) {
    modules.push({ key: "Work order", label: "Work order" });
    for (const row of input.workOrders) {
      if (row.status !== "planned" && row.status !== "in_progress") continue;
      const item = [row.sku?.trim() ?? "", row.description?.trim() ?? ""].filter(Boolean).join(" — ");
      pushRecord(records, {
        id: `wo-${row.id}`,
        module: "Work order",
        href: `/work-orders/${row.id}`,
        number: `WO-${row.id}`,
        title: item || row.notes?.trim() || `Work order #${row.id}`,
        status: row.status,
        plantId: null,
        owner: personName(names, row.createdBy),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }, now, plantName);
    }
  }

  records.sort((a, b) => {
    const left = a.ageDays ?? -1;
    const right = b.ageDays ?? -1;
    if (left !== right) return right - left;
    return a.module.localeCompare(b.module) || a.number.localeCompare(b.number);
  });
  return { records, modules };
}

function count(records: OpenWorkRecord[], module: string): number {
  return records.filter((row) => row.module === module).length;
}

export function buildOpenWork(input: OpenWorkInput): OpenWork {
  const built = buildRecords(input);
  const { access } = input;
  const cards: OpenWorkCard[] = [];

  if (access.ncr) {
    const rows = input.ncrs.filter((row) => !row.isDeleted && row.status !== "closed" && inScope(row.siteId, input.siteIds));
    const high = rows.filter((row) => row.severity === "high" || row.severity === "critical").length;
    cards.push({ key: "ncr", label: "Open NCRs", value: rows.length, foot: `${high} high / critical`, href: "/iso-forms/frm-ncr-001", module: "NCR" });
  }

  if (access.capa || access.scar) {
    const capas = access.capa ? count(built.records, "CAPA") : 0;
    const cars = access.scar ? count(built.records, "CAR") : 0;
    const both = access.capa && access.scar;
    cards.push({
      key: "capa",
      label: both ? "Open CAPAs / CARs" : access.capa ? "Open CAPAs" : "Open CARs",
      value: capas + cars,
      foot: both ? `${capas} ${capas === 1 ? "CAPA" : "CAPAs"} · ${cars} supplier ${cars === 1 ? "CAR" : "CARs"}` : "Not closed",
      href: access.capa ? "/capa" : "/scar-forms",
      module: both ? null : access.capa ? "CAPA" : "CAR",
      modules: both ? ["CAPA", "CAR"] : null,
    });
  }

  if (access.documents) {
    const validation = count(built.records, "VAL");
    const fai = count(built.records, "FAI");
    const trp = count(built.records, "TRP");
    cards.push({
      key: "validation",
      label: "Open validation",
      value: validation + fai + trp,
      foot: companyNote(input.allPlants, `${validation} validation · ${fai} FAI · ${trp} TRP`),
      href: null,
      module: null,
      modules: ["VAL", "FAI", "TRP"],
    });
    const ecrs = count(built.records, "ECR");
    const changes = access.change ? count(built.records, "Change") : 0;
    if (access.change) {
      cards.push({
        key: "ecr",
        label: "Open ECRs",
        value: ecrs + changes,
        foot: companyNote(input.allPlants, `${ecrs} ${ecrs === 1 ? "ECR form" : "ECR forms"} · ${changes} ${changes === 1 ? "change request" : "change requests"}`),
        href: null,
        module: null,
        modules: ["ECR", "Change"],
      });
    } else {
      cards.push({
        key: "ecr",
        label: "Open ECRs",
        value: ecrs,
        foot: companyNote(input.allPlants, "ECR forms"),
        href: "/iso-forms/frm-ecr-001",
        module: "ECR",
      });
    }
  } else if (access.change) {
    const changes = count(built.records, "Change");
    cards.push({
      key: "ecr",
      label: "Open change requests",
      value: changes,
      foot: companyNote(input.allPlants, "Not implemented or rejected"),
      href: "/change",
      module: "Change",
    });
  }

  if (access.calibration) {
    const overdue = input.equipment.filter((row) => row.dueStatus === "overdue").length;
    const failed = input.equipment.filter((row) => row.dueStatus === "failed").length;
    cards.push({
      key: "calibration",
      label: "Overdue calibration",
      value: overdue + failed,
      foot: companyNote(input.allPlants, `${failed} failed · ${overdue} overdue`),
      href: "/calibration",
      module: null,
    });
  }

  if (access.training) {
    const people = input.allPlants ? null : usersAt(input.userSites, input.siteIds);
    const rows = people ? input.assignments.filter((row) => people.has(row.userId)) : input.assignments;
    const overdue = rows.filter((row) => assignmentOverdue(row, input.now)).length;
    cards.push({
      key: "training",
      label: "Overdue training",
      value: overdue,
      foot: rows.length === 0 ? "No assignments yet" : `${rows.length} assignments`,
      href: "/training",
      module: null,
    });
  }

  return {
    cards,
    modules: built.modules,
    plants: input.sites.map((site) => ({ id: site.id, name: site.name })),
    records: built.records.slice(0, RECORD_LIMIT),
    truncated: built.records.length > RECORD_LIMIT,
  };
}

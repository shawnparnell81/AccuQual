/** Titles, tooltips, and paths for a number on the executive dashboard. */

export interface DrillTarget {
  kind: string;
  bucket: string;
  label: string;
  dateRange: string;
  siteId: number | null;
  siteName: string;
  value: number;
}

export function executiveListPath(target: Pick<DrillTarget, "kind" | "bucket" | "dateRange" | "siteId">): string {
  const params = new URLSearchParams({
    kind: target.kind,
    bucket: target.bucket,
    dateRange: target.dateRange,
    siteId: target.siteId == null ? "unassigned" : String(target.siteId),
  });
  return `/executive/list?${params.toString()}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** The words after "Open N" in the tooltip, for example "open FAIs". */
export function drillNoun(target: Pick<DrillTarget, "kind" | "bucket" | "label" | "value">): string {
  const n = target.value;
  if (target.kind === "fai" && target.bucket === "open") return plural(n, "open FAI", "open FAIs");
  if (target.kind === "fai" && target.bucket === "pass") return plural(n, "passed FAI", "passed FAIs");
  if (target.kind === "fai" && target.bucket === "fail") return plural(n, "failed FAI", "failed FAIs");
  if (target.bucket === "labor") return plural(n, "open labor claim", "open labor claims");
  if (target.bucket === "eightd") return plural(n, "open 8D report", "open 8D reports");
  if (target.kind === "open_ncrs" && target.bucket === "open") return plural(n, "open NCR", "open NCRs");
  if (target.kind === "open_capas" && target.bucket === "open") return plural(n, "open CAPA", "open CAPAs");
  if (target.kind === "audits" && target.bucket === "open") return plural(n, "open audit", "open audits");
  if (target.kind === "complaints" && target.bucket === "open") return plural(n, "open complaint", "open complaints");
  if (target.kind === "warranty" && target.bucket === "open") return plural(n, "open warranty claim", "open warranty claims");
  if (target.kind === "overdue" && (target.bucket === "overdue" || target.bucket.startsWith("type:"))) {
    return plural(n, `overdue ${target.label.replace(/s$/, "")}`.trim(), `overdue ${target.label}`);
  }
  if (target.bucket.startsWith("age:")) return plural(n, `NCR aged ${target.label}`, `NCRs aged ${target.label}`);
  if (target.bucket.startsWith("status:")) return plural(n, `${target.label} record`, `${target.label} records`);
  if (target.bucket.startsWith("category:")) return plural(n, `${target.label} NCR`, `${target.label} NCRs`);
  return plural(n, target.label, target.label);
}

export function drillTooltip(target: DrillTarget): string {
  if (target.value <= 0) {
    if (target.kind === "fai" && target.bucket === "open") return `No open FAIs at ${target.siteName}`;
    return `Nothing to open at ${target.siteName}`;
  }
  return `Open ${target.value} ${drillNoun(target)} at ${target.siteName}`;
}

export function drillHeading(target: DrillTarget): string {
  if (target.kind === "fai" && target.bucket === "open") return `Open FAIs — ${target.siteName} (${target.value})`;
  if (target.kind === "fai" && target.bucket === "pass") return `Passed FAIs — ${target.siteName} (${target.value})`;
  if (target.kind === "fai" && target.bucket === "fail") return `Failed FAIs — ${target.siteName} (${target.value})`;
  if (target.bucket === "labor") return `Open labor claims — ${target.siteName} (${target.value})`;
  if (target.bucket === "eightd") return `Open 8D reports — ${target.siteName} (${target.value})`;
  if (target.kind === "open_ncrs" && target.bucket === "open") return `Open NCRs — ${target.siteName} (${target.value})`;
  if (target.kind === "open_capas" && target.bucket === "open") return `Open CAPAs — ${target.siteName} (${target.value})`;
  if (target.kind === "audits" && target.bucket === "open") return `Open audits — ${target.siteName} (${target.value})`;
  if (target.kind === "complaints" && target.bucket === "open") return `Open complaints — ${target.siteName} (${target.value})`;
  if (target.kind === "warranty" && target.bucket === "open") return `Open warranty claims — ${target.siteName} (${target.value})`;
  if (target.bucket === "overdue") return `Overdue items — ${target.siteName} (${target.value})`;
  return `${target.label} — ${target.siteName} (${target.value})`;
}

export function drillDetail(kind: string, bucket: string): string {
  if (kind === "fai" && bucket === "open") {
    return "Saved CSA Validation, Fuel Pump Validation, and First Article forms that are still open or in progress.";
  }
  if (kind === "fai") return "Saved CSA Validation, Fuel Pump Validation, and First Article forms.";
  if (bucket === "labor") return "Open labor claims for this plant and date range.";
  if (bucket === "eightd") return "8D reports still in progress for this plant and date range.";
  return "Records in this count, for this plant and date range.";
}

const MODULE_NOUN: Record<string, string> = {
  ncr: "NCR records",
  capa: "CAPA records",
  audit: "audits",
  complaints: "complaints",
  warranty: "warranty claims",
  labor_claims: "labor claims",
  documents: "these forms",
  qms_forms: "QMS forms",
  eight_d: "8D reports",
};

export function permissionMessage(module: string | null): string {
  const noun = (module && MODULE_NOUN[module]) || "this record";
  return `You don't have permission to view ${noun}.`;
}

export function tabIconForHref(href: string): string {
  if (href.startsWith("/ncr")) return "ncr";
  if (href.startsWith("/capa") || href.startsWith("/8d") || href.startsWith("/complaints")) return "capa";
  if (href.startsWith("/audits")) return "audit";
  if (href.startsWith("/validation-reports") || href.startsWith("/iso-forms") || href.startsWith("/documents") || href.startsWith("/qms-forms") || href.startsWith("/form-folders")) {
    return "documents";
  }
  return "default";
}

export function canViewModule(module: string | null, levels: Record<string, string> | null | undefined, loading: boolean): boolean {
  if (!module || loading || !levels) return true;
  if (!(module in levels)) return true;
  return levels[module] !== "none";
}

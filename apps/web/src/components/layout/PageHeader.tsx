import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface Crumb {
  label: string;
  to?: string;
}

/** Page title, where you are, and the one or two actions for this page. */
export function PageHeader({
  crumbs,
  title,
  description,
  actions,
}: {
  crumbs?: Crumb[];
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="aq-page-head">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="aq-crumbs">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="aq-crumb">
              {index > 0 && <span aria-hidden="true">/</span>}
              {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span>{crumb.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="aq-page-title">{title}</h1>
          {description && <div className="aq-page-desc">{description}</div>}
        </div>
        {actions && <div className="aq-page-actions">{actions}</div>}
      </div>
    </header>
  );
}

export interface SummaryItem {
  label: string;
  value: string | number;
  detail?: string;
  /** The one number on the page that uses DMA Blue. */
  accent?: boolean;
}

/** A short row of counts. One card carries the blue accent; the rest stay quiet. */
export function SummaryCards({ items }: { items: SummaryItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="aq-summary">
      {items.map((item) => (
        <article key={item.label} className={item.accent ? "aq-summary-card accent" : "aq-summary-card"}>
          <p className="aq-summary-label">{item.label}</p>
          <p className="aq-summary-value">{item.value}</p>
          {item.detail && <p className="aq-summary-detail">{item.detail}</p>}
        </article>
      ))}
    </div>
  );
}

/** Filters sit on one quiet bar. Labels stay words, not a row of icons. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="aq-filter-bar">{children}</div>;
}

/** Counts for a list whose rows carry a status string. The first card is the total. */
export function summarizeRecords(rows: readonly unknown[]): SummaryItem[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const status = (row as { status?: unknown }).status;
    if (typeof status !== "string" || !status.trim()) continue;
    const label = status.replace(/_/g, " ");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const items: SummaryItem[] = [{ label: "Records", value: rows.length, accent: true }];
  for (const [label, value] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    items.push({ label, value });
  }
  return items;
}

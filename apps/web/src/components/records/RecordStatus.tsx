import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { Check } from "lucide-react";
import { StatusBadge } from "../tables/StatusBadge";

export function RecordCrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1">
          {index > 0 && <span aria-hidden>/</span>}
          {item.to ? (
            <Link to={item.to} className="hover:text-foreground hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function LoopTrail({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-y-2 text-xs">
      {steps.map((label, index) => {
        const state = index < current ? "done" : index === current ? "now" : "later";
        return (
          <li key={label} className="flex items-center">
            {index > 0 && <span aria-hidden className={clsx("mx-2 h-0.5 w-5 rounded-full sm:w-9", index <= current ? "bg-success" : "bg-border")} />}
            <span className="flex items-center gap-1.5">
              <span
                className={clsx(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  state === "done" && "bg-success text-success-foreground",
                  state === "now" && "bg-primary text-primary-foreground ring-4 ring-primary/25",
                  state === "later" && "bg-muted text-muted-foreground"
                )}
              >
                {state === "done" ? <Check size={11} strokeWidth={3} /> : index + 1}
              </span>
              <span className={clsx(state === "now" ? "font-semibold text-foreground" : state === "done" ? "text-foreground/80" : "text-muted-foreground")}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function GlanceCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

/**
 * One strip for state, owner, due date, who it's waiting on, and the next
 * action. Callers pass values already stored on the record (or derived from
 * its status). `ownerControl` / `dueControl` replace the text when the
 * viewer can edit that field.
 */
export function RecordGlance({
  crumbs,
  title,
  standard,
  stateValue,
  stateLabel,
  owner,
  ownerControl,
  due,
  dueLate,
  dueControl,
  blocked,
  next,
  accessNote,
  actions,
  trail,
}: {
  crumbs?: { label: string; to?: string }[];
  title: string;
  standard?: string;
  stateValue: string | null;
  stateLabel: string;
  owner: string;
  ownerControl?: ReactNode;
  due: string;
  dueLate?: boolean;
  dueControl?: ReactNode;
  blocked: string;
  next: string;
  accessNote?: string | null;
  actions?: ReactNode;
  trail?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {crumbs && crumbs.length > 0 && <RecordCrumbs items={crumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {standard && <p className="text-xs text-muted-foreground">{standard}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-5">
        <GlanceCell label="State">
          <StatusBadge value={stateValue} label={stateLabel} />
        </GlanceCell>
        <GlanceCell label="Owner">{ownerControl ?? <span className="truncate">{owner}</span>}</GlanceCell>
        <GlanceCell label="Due">
          {dueControl ?? <span className={dueLate ? "font-medium text-destructive" : undefined}>{due}</span>}
        </GlanceCell>
        <GlanceCell label="Blocked on">
          <span className="line-clamp-2">{blocked}</span>
        </GlanceCell>
        <GlanceCell label="Next">
          <span className="line-clamp-3">{next}</span>
        </GlanceCell>
      </div>
      {accessNote && <p className="text-sm text-muted-foreground">{accessNote}</p>}
      {trail}
    </div>
  );
}

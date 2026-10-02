import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ListChecks } from "lucide-react";
import type { OpenWork } from "../../api/dashboard";
import { cardFilterKeys, filterToken, rowInModuleFilter } from "../../lib/openWorkFilter";
import { StatusBadge } from "../tables/StatusBadge";
import { statusPhrase } from "../../lib/opsLanguage";

const TONE: Record<string, string> = {
  ncr: "primary",
  capa: "brand-purple",
  validation: "info",
  ecr: "warning",
  calibration: "destructive",
  training: "warning",
};

function when(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function CardShell({
  tone,
  pressed,
  href,
  onClick,
  children,
}: {
  tone: string;
  pressed: boolean;
  href: string | null;
  onClick: (() => void) | null;
  children: ReactNode;
}) {
  const className = `kpi-tile block h-full w-full rounded-[14px] p-4 text-left no-underline ${onClick || href ? "kpi-hover cursor-pointer" : ""} ${onClick ? "font-inherit" : ""} ${pressed ? "ring-1 ring-primary" : ""}`;
  const style = { ["--tone" as string]: `var(--${tone})` };
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={pressed} className={className} style={style}>
        {children}
      </button>
    );
  }
  if (href) {
    return (
      <Link to={href} className={className} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

/** Counts and one list of open quality records the signed-in person can already open. */
export function OpenWorkSection({
  work,
  singlePlant,
  moduleFilter,
  onModuleFilter,
}: {
  work: OpenWork;
  singlePlant: boolean;
  moduleFilter?: string;
  onModuleFilter?: (module: string) => void;
}) {
  const [localModule, setLocalModule] = useState("");
  const module = moduleFilter ?? localModule;
  const setModule = onModuleFilter ?? setLocalModule;
  const [status, setStatus] = useState("");
  const [plant, setPlant] = useState("");

  if (work.cards.length === 0) return null;

  const plantActive = work.plants.some((row) => String(row.id) === plant) ? plant : "";
  const moduleRows = work.records.filter((row) => {
    if (!rowInModuleFilter(row.module, module)) return false;
    if (plantActive && String(row.plantId ?? "") !== plantActive) return false;
    return true;
  });
  const groupedCard = work.cards.find((card) => {
    const keys = cardFilterKeys(card);
    return keys != null && keys.length > 1 && filterToken(keys) === module;
  });
  const statuses = [...new Set(moduleRows.map((row) => row.status))].sort();
  const statusActive = statuses.includes(status) ? status : "";
  const rows = statusActive ? moduleRows.filter((row) => row.status === statusActive) : moduleRows;
  const showPlant = work.plants.length > 1;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 font-display text-base font-bold">
          <ListChecks size={16} className="text-primary" /> Open quality work
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Open records from the modules you can already use.
          {singlePlant ? " Validation, changes, PPAP, risk, and work orders are company-wide." : ""}
          {showPlant ? " A plant filter keeps issues and fixes for that plant. Records with no plant stay under All plants." : ""}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {work.cards.map((card) => {
          const tone = card.key === "calibration" && card.value === 0 ? "info" : card.key === "training" && card.value === 0 ? "success" : (TONE[card.key] ?? "primary");
          const keys = cardFilterKeys(card);
          const token = keys ? filterToken(keys) : "";
          const pressed = token !== "" && module === token;
          return (
            <CardShell
              key={card.key}
              tone={tone}
              pressed={pressed}
              href={keys ? null : card.href}
              onClick={
                keys
                  ? () => {
                      setModule(pressed ? "" : token);
                      setStatus("");
                    }
                  : null
              }
            >
              <div className="relative text-[0.76rem] text-muted-foreground">{card.label}</div>
              <div className="relative mt-2 font-display text-[2rem] font-extrabold leading-none text-foreground">{card.value}</div>
              <div className="relative mt-1.5 text-[0.74rem] text-muted-foreground">{card.foot}</div>
            </CardShell>
          );
        })}
      </div>

      <div id="open-records" className="min-w-0 scroll-mt-4 rounded-[14px] border border-border bg-card shadow-[inset_0_1px_0_hsl(var(--foreground)/0.04)]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3.5">
          <h3 className="font-display text-base font-bold">Open records</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Record type"
              value={module}
              onChange={(event) => {
                setModule(event.target.value);
                setStatus("");
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="">All types</option>
              {groupedCard ? <option value={module}>{groupedCard.label}</option> : null}
              {work.modules.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
            <select aria-label="Status" value={statusActive} onChange={(event) => setStatus(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
              <option value="">All statuses</option>
              {statuses.map((item) => (
                <option key={item} value={item}>
                  {statusPhrase(item)}
                </option>
              ))}
            </select>
            {showPlant && (
              <select aria-label="Plant" value={plantActive} onChange={(event) => setPlant(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                <option value="">All plants</option>
                {work.plants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </header>
        <div className="p-4">
          {work.truncated && <p className="mb-2 text-xs text-muted-foreground">Showing the 300 oldest open records. The counts above include the rest.</p>}
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No open records match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Type</th>
                    <th className="pb-2 font-medium">Number</th>
                    <th className="pb-2 font-medium">Summary</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Plant</th>
                    <th className="pb-2 font-medium">Owner</th>
                    <th className="pb-2 font-medium">Updated</th>
                    <th className="pb-2 font-medium">Aging</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="py-2 font-medium">{row.module}</td>
                      <td className="py-2">
                        <Link to={row.href} className="font-mono text-xs font-semibold text-primary no-underline hover:underline">
                          {row.number}
                        </Link>
                      </td>
                      <td className="max-w-[18rem] truncate py-2">
                        <Link to={row.href} className="text-foreground no-underline hover:text-primary">
                          {row.title}
                        </Link>
                      </td>
                      <td className="py-2">
                        <StatusBadge value={row.status} label={statusPhrase(row.status)} />
                      </td>
                      <td className="py-2">{row.plant ?? "—"}</td>
                      <td className="py-2">{row.owner ?? "—"}</td>
                      <td className="py-2 text-muted-foreground">{when(row.updatedAt)}</td>
                      <td className="py-2 tabular-nums">{row.ageDays == null ? "—" : `${row.ageDays}d`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

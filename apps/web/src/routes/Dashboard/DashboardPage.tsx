import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Calendar,
  Check,
  ClipboardCheck,
  Clock,
  Command,
  Factory,
  FileText,
  Gauge,
  GitBranch,
  GraduationCap,
  Layers,
  Plus,
  Sparkles,
  Wrench,
} from "lucide-react";
import { apiClient } from "../../api/client";
import type { DashboardOverview } from "../../api/dashboard";
import { useCurrentUser } from "../../hooks/useAuth";
import { usePlantWrite } from "../../hooks/usePlantWrite";
import { useSites, useSwitchPlant } from "../../hooks/useSites";
import { FRM_NCR_PATH } from "../../lib/qualityEntry";
import { filterToken } from "../../lib/openWorkFilter";
import type { OpenWork } from "../../api/dashboard";
import { useSiteStore } from "../../store/siteStore";
import { OpenWorkSection } from "../../components/dashboard/OpenWorkSection";
import { AgingChart, ParetoChart, PlantChart, Sparkline, TrendChart } from "./charts";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function headline(data: DashboardOverview): string {
  const bits: string[] = [];
  const issues = data.kpis.openIssues;
  const fixes = data.kpis.overdueFixes;
  const gages = data.kpis.calibration;
  if (issues.access && issues.value != null) bits.push(`${issues.value} open ${issues.value === 1 ? "issue" : "issues"}`);
  if (fixes.access && fixes.value != null) bits.push(`${fixes.value} late ${fixes.value === 1 ? "fix" : "fixes"}`);
  if (gages.access && gages.overdue != null && gages.failed != null) {
    const n = gages.overdue + gages.failed;
    bits.push(`${n} overdue ${n === 1 ? "gage" : "gages"}`);
  }
  if (bits.length === 0) return "Here's what you can see today.";
  const where = data.scope.label === "All plants" ? "across all plants" : `at ${data.scope.label}`;
  const sentence = `${bits.join(", ").replace(/, ([^,]*)$/, " and $1")} ${where}.`;
  if (gages.access && data.scope.label !== "All plants") return `${sentence} Gage counts cover the whole company.`;
  return sentence;
}

function openCommands() {
  window.dispatchEvent(new Event("accuqual-open-palette"));
}

function DueChip({ due }: { due: string | null }) {
  if (!due) return null;
  const date = new Date(due);
  if (Number.isNaN(date.getTime())) return null;
  const late = date.getTime() < Date.now();
  const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <span className={`shrink-0 rounded-full border px-2 py-1 text-[0.72rem] font-semibold ${late ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border text-muted-foreground"}`}>
      {late ? `Late ${label}` : label}
    </span>
  );
}

function RecLink({ href, children }: { href: string; children: string }) {
  return (
    <Link to={href} className="inline-flex shrink-0 items-center rounded-md border border-primary/35 bg-primary/10 px-2 py-1 font-mono text-xs font-semibold text-primary no-underline hover:bg-primary/20">
      {children}
    </Link>
  );
}

function Card({ title, icon, extra, children }: { title: string; icon?: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-[14px] border border-border bg-card shadow-[inset_0_1px_0_hsl(var(--foreground)/0.04)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3.5">
        <h2 className="flex items-center gap-2 font-display text-base font-bold">
          {icon}
          {title}
        </h2>
        {extra}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Legend({ items }: { items: { token: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: `hsl(var(--${item.token}))` }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function sliceToken(work: OpenWork, keys: string[]): string | null {
  const present = keys.filter((key) => work.modules.some((module) => module.key === key));
  if (present.length === 0) return null;
  return filterToken(present);
}

function Kpi({
  href,
  onDrill,
  token,
  delay,
  icon,
  label,
  pill,
  value,
  unit,
  foot,
  spark,
}: {
  href?: string;
  onDrill?: () => void;
  token: string;
  delay: number;
  icon: ReactNode;
  label: string;
  pill?: string;
  value: ReactNode;
  unit?: string;
  foot: string;
  spark?: number[];
}) {
  const body = (
    <>
      <div className="relative flex items-center gap-1.5 text-[0.76rem] text-muted-foreground">
        {icon}
        <span>{label}</span>
        {pill ? <span className="rounded-md bg-foreground/5 px-1.5 py-0.5 font-mono text-[0.7rem]">{pill}</span> : null}
      </div>
      <div className="relative mt-2 font-display text-[2rem] font-extrabold leading-none text-foreground">
        {value}
        {unit ? <small className="ml-0.5 text-sm font-semibold text-muted-foreground">{unit}</small> : null}
      </div>
      <div className="relative mt-1.5 flex items-center justify-between gap-2 text-[0.74rem] text-muted-foreground">
        <span>{foot}</span>
        {spark ? <Sparkline values={spark} token={token === "brand-purple" ? "brand-purple" : token} /> : null}
      </div>
    </>
  );
  const clickable = Boolean(href || onDrill);
  const className = `kpi-tile reveal block w-full rounded-[14px] p-4 text-left no-underline${clickable ? " kpi-hover cursor-pointer" : ""}`;
  const style = { ["--tone" as string]: `var(--${token})`, ["--d" as string]: `${delay}ms` };
  if (onDrill) {
    return (
      <button type="button" onClick={onDrill} className={className} style={style} title="Show these records in the open list">
        {body}
      </button>
    );
  }
  if (!href) {
    return (
      <div className={className} style={style}>
        {body}
      </div>
    );
  }
  return (
    <Link to={href} className={className} style={style}>
      {body}
    </Link>
  );
}

function StatusTile({ label, value, detail, token }: { label: string; value: string; detail: string; token: string }) {
  return (
    <div className="kpi-tile rounded-[14px] p-4" style={{ ["--tone" as string]: `var(--${token})` }}>
      <div className="relative text-[0.76rem] text-muted-foreground">{label}</div>
      <p className="relative mt-2 font-display text-lg font-bold text-muted-foreground">{value}</p>
      <p className="relative mt-1 text-[0.74rem] text-muted-foreground">{detail}</p>
    </div>
  );
}

function EmptyNote({ children }: { children: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Signed-in home for quality leads: the prototype dashboard, filled from live records. */
export function DashboardPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { data: plants } = useSites();
  const siteId = useSiteStore((s) => s.currentSiteId);
  const switchPlant = useSwitchPlant();
  const reportIssue = usePlantWrite("ncr");
  const scheduleAudit = usePlantWrite("audit");
  const activePlants = (plants?.sites ?? []).filter((site) => site.status === "active");
  const multi = activePlants.length > 1;
  const [allPlants, setAllPlants] = useState(true);
  const [drill, setDrill] = useState("");
  const scope = multi && allPlants ? "all" : "current";

  const query = useQuery({
    queryKey: ["dashboard", "overview", scope, scope === "all" ? "all" : siteId],
    queryFn: async () => (await apiClient.get<DashboardOverview>("/dashboard/overview", { params: { scope } })).data,
    enabled: scope === "all" || siteId != null,
  });

  const data = query.data;
  const first = user?.name?.split(" ")[0];
  const today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const singlePlant = !data?.scope.allPlants && data?.scope.label !== "All plants";

  function drillTo(token: string) {
    setDrill(token);
    document.getElementById("open-records")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const calFoot = (row: DashboardOverview["kpis"]["calibration"]) => {
    if (row.overdue == null || row.failed == null || row.dueSoon == null) return "No access";
    const base = row.failed > 0 ? `${row.failed} failed · ${row.overdue} overdue · ${row.dueSoon} due ≤30d` : `${row.overdue} overdue · ${row.dueSoon} due ≤30d`;
    return singlePlant ? `${base} · company-wide` : base;
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <section className="hero-surface rounded-[14px] px-5 py-5 md:px-6">
        <div className="cc-grid" aria-hidden />
        <div className="relative z-[1] flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="led" style={{ ["--tone" as string]: "var(--success)" }} />
              Live · {data?.scope.label ?? (scope === "all" ? "All plants" : "This plant")} · {today}
            </p>
            <h1 className="glow-text mt-2 font-display text-[1.6rem] font-extrabold tracking-tight">
              {greeting()}
              {first ? `, ${first}` : ""}.
            </h1>
            <p className="mt-1.5 max-w-xl text-muted-foreground">{data ? headline(data) : query.isError ? "The dashboard couldn't load." : "Loading today's numbers…"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {multi && (
              <div className="inline-flex overflow-hidden rounded-[10px] border border-border bg-card/70 text-xs font-semibold">
                <button type="button" aria-pressed={allPlants} onClick={() => setAllPlants(true)} className={`px-3 py-2 ${allPlants ? "bg-primary/15 text-foreground" : "text-muted-foreground"}`}>
                  All plants
                </button>
                <button type="button" aria-pressed={!allPlants} onClick={() => setAllPlants(false)} className={`px-3 py-2 ${!allPlants ? "bg-primary/15 text-foreground" : "text-muted-foreground"}`}>
                  This plant
                </button>
              </div>
            )}
            {reportIssue.canEdit && (
              <button type="button" onClick={() => navigate(FRM_NCR_PATH)} className="inline-flex items-center gap-1.5 rounded-[10px] bg-gradient-to-br from-primary to-[hsl(var(--brand-purple))] px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-[0_8px_22px_-10px_hsl(var(--primary)/0.85)]">
                <Plus size={16} /> Report issue
              </button>
            )}
            {scheduleAudit.canEdit && (
              <button type="button" onClick={() => navigate("/audits?new=1")} className="inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-card/80 px-3.5 py-2 text-sm font-semibold hover:border-primary/50">
                <Calendar size={16} /> Schedule audit
              </button>
            )}
            <button type="button" onClick={openCommands} className="hidden items-center gap-1.5 rounded-[10px] border border-border bg-card/80 px-3.5 py-2 text-sm font-semibold hover:border-primary/50 sm:inline-flex">
              <Command size={16} /> Commands <kbd className="rounded border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[0.68rem] text-muted-foreground">Ctrl K</kbd>
            </button>
          </div>
        </div>
      </section>

      {query.isError && (
        <div className="rounded-[14px] border border-destructive/40 bg-card p-4 text-sm">
          The dashboard couldn't load.{" "}
          <button type="button" onClick={() => query.refetch()} className="font-semibold text-primary">
            Try again
          </button>
        </div>
      )}

      {query.isLoading && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton h-28 rounded-[14px]" />
          ))}
        </div>
      )}

      {data && (
        <>
          {data.partial && <p className="text-xs text-muted-foreground">Some older records were left out of these counts so the page stays fast.</p>}
          <OpenWorkSection work={data.openWork} singlePlant={singlePlant} moduleFilter={drill} onModuleFilter={setDrill} />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <Kpi
              onDrill={data.kpis.openIssues.access && sliceToken(data.openWork, ["NCR"]) ? () => drillTo(sliceToken(data.openWork, ["NCR"])!) : undefined}
              href={data.kpis.openIssues.access ? FRM_NCR_PATH : undefined}
              token="primary"
              delay={0}
              icon={<AlertTriangle size={15} />}
              label="Open issues"
              pill="NCR"
              value={data.kpis.openIssues.access ? data.kpis.openIssues.value : "—"}
              foot={data.kpis.openIssues.access ? `${data.kpis.openIssues.highCritical ?? 0} high / critical` : "No access"}
              spark={data.kpis.openIssues.spark}
            />
            <Kpi
              onDrill={data.kpis.overdueFixes.access && sliceToken(data.openWork, ["CAPA"]) ? () => drillTo(sliceToken(data.openWork, ["CAPA"])!) : undefined}
              href={data.kpis.overdueFixes.access ? "/capa" : undefined}
              token="destructive"
              delay={60}
              icon={<ClipboardCheck size={15} />}
              label="Overdue fixes"
              pill="CAPA"
              value={data.kpis.overdueFixes.access ? data.kpis.overdueFixes.value : "—"}
              foot={data.kpis.overdueFixes.access ? `${data.kpis.overdueFixes.openTotal ?? 0} open in total` : "No access"}
            />
            <Kpi
              href={data.kpis.docsDue.access ? "/documents" : undefined}
              token="warning"
              delay={120}
              icon={<FileText size={15} />}
              label="Docs due for review"
              value={data.kpis.docsDue.access ? data.kpis.docsDue.value : "—"}
              foot={
                data.kpis.docsDue.access
                  ? `${data.kpis.docsDue.waitingApproval ?? 0} waiting for approval${singlePlant ? " · company-wide" : ""}`
                  : "No access"
              }
            />
            <Kpi
              href={data.kpis.training.access ? "/training" : undefined}
              token={data.kpis.training.percent != null && data.kpis.training.percent >= 90 ? "success" : "warning"}
              delay={180}
              icon={<GraduationCap size={15} />}
              label="Training compliance"
              value={data.kpis.training.access ? (data.kpis.training.percent == null ? "—" : data.kpis.training.percent) : "—"}
              unit={data.kpis.training.percent != null ? "%" : undefined}
              foot={
                !data.kpis.training.access
                  ? "No access"
                  : data.kpis.training.assigned === 0
                    ? "No assignments yet"
                    : `${data.kpis.training.overdue ?? 0} overdue assignments`
              }
            />
            <Kpi
              href={data.kpis.calibration.access ? "/calibration" : undefined}
              token={(data.kpis.calibration.overdue ?? 0) + (data.kpis.calibration.failed ?? 0) > 0 ? "destructive" : "info"}
              delay={240}
              icon={<Gauge size={15} />}
              label="Calibration due"
              pill="Gages"
              value={data.kpis.calibration.access ? data.kpis.calibration.value : "—"}
              foot={calFoot(data.kpis.calibration)}
            />
            <Kpi
              href={data.kpis.auditFindings.access ? "/audits" : undefined}
              token="brand-purple"
              delay={300}
              icon={<ClipboardCheck size={15} />}
              label="Open audit findings"
              value={data.kpis.auditFindings.access ? data.kpis.auditFindings.value : "—"}
              foot={data.kpis.auditFindings.access ? `${data.kpis.auditFindings.total ?? 0} findings & observations` : "No access"}
            />
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display text-base font-bold">
                <Wrench size={16} className="text-primary" /> Engineering
              </h2>
              <span className="text-xs text-muted-foreground">PPAP · changes · deviations · APQP</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {data.engineering.changes.access ? (
                <Kpi
                  onDrill={sliceToken(data.openWork, ["ECR", "Change"]) ? () => drillTo(sliceToken(data.openWork, ["ECR", "Change"])!) : undefined}
                  href="/change"
                  token="primary"
                  delay={0}
                  icon={<GitBranch size={15} />}
                  label="Open change requests"
                  value={data.engineering.changes.open}
                  foot={`${data.engineering.changes.inReview ?? 0} in review · ${data.engineering.changes.approved ?? 0} approved${singlePlant ? " · company-wide" : ""}`}
                />
              ) : (
                <StatusTile label="Open change requests" value="No access" detail="You don't have access to change requests." token="primary" />
              )}
              {data.engineering.ppap.access ? (
                <Kpi
                  onDrill={sliceToken(data.openWork, ["PPAP"]) ? () => drillTo(sliceToken(data.openWork, ["PPAP"])!) : undefined}
                  href="/ppap"
                  token="brand-purple"
                  delay={0}
                  icon={<Layers size={15} />}
                  label="PPAPs pending"
                  value={data.engineering.ppap.pending}
                  foot={`${data.engineering.ppap.awaitingCustomer ?? 0} awaiting customer${singlePlant ? " · company-wide" : ""}`}
                />
              ) : (
                <StatusTile label="PPAPs pending" value="No access" detail="You don't have access to PPAP." token="brand-purple" />
              )}
              {data.kpis.docsDue.access ? (
                <Kpi
                  href="/iso-forms/frm-ncr-003"
                  token="warning"
                  delay={0}
                  icon={<AlertTriangle size={15} />}
                  label="Deviations"
                  value="Open"
                  foot="Concession / deviation requests"
                />
              ) : (
                <StatusTile label="Deviations" value="No access" detail="You don't have access to deviation requests." token="warning" />
              )}
              {data.kpis.docsDue.access ? (
                <Kpi
                  href="/folders/apqp"
                  token="info"
                  delay={0}
                  icon={<Layers size={15} />}
                  label="APQP gates"
                  value="Open"
                  foot="Packets and gate documents"
                />
              ) : (
                <StatusTile label="APQP gates" value="No access" detail="You don't have access to APQP gate documents." token="info" />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card
              title="Issue trend"
              icon={<Sparkles size={16} className="text-primary" />}
              extra={<Legend items={[{ token: "primary", label: "Opened" }, { token: "success", label: "Closed" }]} />}
            >
              {data.trend.access ? (
                <>
                  <TrendChart labels={data.trend.labels} opened={data.trend.opened} closed={data.trend.closed} />
                  <p className="mt-2 text-xs text-muted-foreground">Weekly, last 12 weeks · {data.scope.label}</p>
                </>
              ) : (
                <EmptyNote>You don't have access to issues.</EmptyNote>
              )}
            </Card>
            <Card title="Top problems" icon={<Layers size={16} className="text-primary" />} extra={<span className="rounded-md bg-foreground/5 px-1.5 py-0.5 font-mono text-[0.7rem] text-muted-foreground">Pareto</span>}>
              <p className="-mt-1 mb-2 text-right text-xs text-muted-foreground">Recorded root causes · 180 days</p>
              {data.pareto.access ? (
                data.pareto.items.length > 0 ? <ParetoChart items={data.pareto.items} /> : <EmptyNote>No root causes recorded in the last 180 days.</EmptyNote>
              ) : (
                <EmptyNote>You don't have access to issues.</EmptyNote>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card
              title="Aging of open work"
              icon={<Clock size={16} className="text-primary" />}
              extra={
                <Legend
                  items={[
                    ...(data.aging.issues ? [{ token: "primary", label: "Issues" }] : []),
                    ...(data.aging.fixes ? [{ token: "brand-purple", label: "Fixes" }] : []),
                  ]}
                />
              }
            >
              {data.aging.issues || data.aging.fixes ? (
                <AgingChart categories={data.aging.categories} issues={data.aging.issues} fixes={data.aging.fixes} />
              ) : (
                <EmptyNote>You don't have access to issues or fixes.</EmptyNote>
              )}
            </Card>
            <Card title="My tasks" icon={<Check size={16} className="text-primary" />} extra={<span className="rounded-full bg-foreground/5 px-2 py-0.5 font-mono text-xs text-muted-foreground">{data.tasks.length}</span>}>
              {data.tasks.length === 0 ? (
                <EmptyNote>Nothing assigned to you right now.</EmptyNote>
              ) : (
                <ul className="flex max-h-[330px] flex-col gap-2 overflow-auto">
                  {data.tasks.map((task) => (
                    <li key={task.id} className="flex items-start gap-2">
                      <RecLink href={task.href}>{task.ref}</RecLink>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{task.title}</span>
                        <span className="text-xs text-muted-foreground">{task.kind}</span>
                      </span>
                      <DueChip due={task.due} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="What's stuck" icon={<AlertTriangle size={16} className="text-primary" />} extra={<span className="rounded-full bg-foreground/5 px-2 py-0.5 font-mono text-xs text-muted-foreground">{data.stuck.length}</span>}>
              {data.stuck.length === 0 ? (
                <EmptyNote>Nothing is stuck right now.</EmptyNote>
              ) : (
                <ul className="flex max-h-[340px] flex-col gap-2 overflow-auto">
                  {data.stuck.map((item) => (
                    <li key={item.id} className="flex items-start gap-2">
                      <RecLink href={item.href}>{item.ref}</RecLink>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{item.title}</span>
                        <span className="text-xs text-muted-foreground">{item.who}</span>
                      </span>
                      <span className={`shrink-0 rounded-full border px-2 py-1 text-[0.72rem] font-semibold ${item.tone === "bad" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-warning/40 bg-warning/10 text-warning"}`}>
                        {item.why}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card
              title="Plant comparison"
              icon={<Factory size={16} className="text-primary" />}
              extra={
                <Legend
                  items={[
                    { token: "primary", label: "Open issues" },
                    { token: "destructive", label: "Late fixes" },
                    { token: "brand-purple", label: "Training overdue" },
                  ]}
                />
              }
            >
              {data.plants.length === 0 ? (
                <EmptyNote>You aren't assigned to a plant.</EmptyNote>
              ) : (
                <>
                  <PlantChart
                    groups={data.plants.map((plant) => plant.code)}
                    series={[
                      { name: "Open issues", token: "primary", values: data.plants.map((plant) => plant.openIssues) },
                      { name: "Late fixes", token: "destructive", values: data.plants.map((plant) => plant.lateFixes) },
                      { name: "Training overdue", token: "brand-purple", values: data.plants.map((plant) => plant.trainingOverdue) },
                    ]}
                  />
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[32rem] text-sm">
                      <thead className="text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="pb-2 font-medium">Plant</th>
                          <th className="pb-2 font-medium">Open issues</th>
                          <th className="pb-2 font-medium">Late fixes</th>
                          <th className="pb-2 font-medium">Training</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.plants.map((plant) => (
                          <tr key={plant.id} className="border-t border-border">
                            <td className="py-2">
                              <button
                                type="button"
                                className="font-medium text-primary"
                                onClick={() => {
                                  setAllPlants(false);
                                  switchPlant.mutate(plant.id);
                                }}
                              >
                                {plant.name}
                              </button>
                            </td>
                            <td className="py-2 tabular-nums">{plant.openIssues ?? "—"}</td>
                            <td className="py-2 tabular-nums">{plant.lateFixes ?? "—"}</td>
                            <td className="py-2">
                              {plant.trainingPercent == null ? (
                                "—"
                              ) : (
                                <span className="inline-flex items-center gap-2">
                                  <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-foreground/10">
                                    <i className="block h-full" style={{ width: `${plant.trainingPercent}%`, background: `hsl(var(--${plant.trainingPercent >= 90 ? "success" : "warning"}))` }} />
                                  </span>
                                  {plant.trainingPercent}%
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Gages aren't assigned to a plant, so they aren't compared here. Choosing a plant above also switches the rest of the app to that plant.</p>
                </>
              )}
            </Card>
          </div>

          <Card title="Recent activity" icon={<Clock size={16} className="text-primary" />}>
            {data.activity.length === 0 ? (
              <EmptyNote>No recent changes yet.</EmptyNote>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.activity.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 last:border-0">
                    <span className="min-w-0">
                      {item.href ? (
                        <Link to={item.href} className="text-sm font-medium text-foreground no-underline hover:text-primary">
                          {item.text}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium">{item.text}</span>
                      )}
                      <span className="mt-0.5 block text-xs text-muted-foreground">{item.by}</span>
                    </span>
                    {item.at && <span className="text-xs text-muted-foreground">{new Date(item.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

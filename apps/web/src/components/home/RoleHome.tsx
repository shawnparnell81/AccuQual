import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { KpiChartCustomize, KpiPinnedCharts } from "../kpis/KpiBoards";
import { UpdatedStamp } from "../kpis/UpdatedStamp";
import { WorkspaceArrange } from "./WorkspaceArrange";
import { useWorkspaceSurface } from "../../hooks/useWorkspaceLayout";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import type { AccuQualDocument, Audit, Capa, Ncr } from "../../api/types";
import { AttentionStrip } from "../calibration/EquipmentPanels";
import { MonthCalendar } from "../calendar/MonthCalendar";
import { OnboardingChecklist } from "../layout/OnboardingChecklist";
import { TrainingAttentionStrip } from "../training/TrainingPanels";
import { KpiTile, Reveal } from "../dashboard/kit";
import { ArrowRight, ChevronRight } from "lucide-react";
import { useCurrentUser } from "../../hooks/useAuth";
import { useCalendarItems } from "../../hooks/useCalendarItems";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { usePersonDirectory } from "../../hooks/usePersonDirectory";
import { summarizeCalendarItems } from "../../lib/calendarMetrics";
import { departmentPhrase, homeKind, isPastDue, lateItems, ncrNextAction, rolePhrase, statusPhrase, type HomeKind } from "../../lib/opsLanguage";
import { useSites } from "../../hooks/useSites";
import { useSiteStore } from "../../store/siteStore";
import { WorkflowInbox } from "./WorkflowInbox";
import { WaitingOnMe } from "./WaitingOnMe";
import { useRecentRecords } from "../../hooks/useRecentRecords";
import { blankFormsFolderHref } from "../../lib/folderBrowse";
import { FRM_NCR_PATH } from "../../lib/qualityEntry";
import { recordHeading } from "../../lib/userRecordNumber";

function useModuleList<T>(resource: string, enabled: boolean, siteKey: number | null | "shared", params?: Record<string, string>) {
  return useQuery({
    queryKey: [resource, siteKey, params],
    queryFn: async () => (await apiClient.get<T[]>(`/${resource}`, { params })).data,
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

/**
 * Home content for the three jobs this app already seeds: quality lead and
 * administrator share the plant view, auditors get reviews, everyone else
 * (operators and other departments) gets their own assignments. The shell
 * around this page does not change.
 */
export function RoleHome() {
  const user = useCurrentUser();
  const { data: plants } = useSites();
  const siteId = useSiteStore((s) => s.currentSiteId);
  const plantName = plants?.sites.find((site) => site.id === (siteId ?? plants.currentSiteId))?.name;
  const kind = homeKind(user?.roleName);
  const { effective, isLoading: permsLoading } = useEffectivePermissions();
  const bypass = user?.roleName === "admin" || user?.roleName === "owner";
  const ready = bypass || !permsLoading;
  const can = (key: string) => ready && (bypass || (!!effective && effective[key] !== undefined && effective[key] !== "none"));

  const wantPlant = kind === "lead" || kind === "auditor";
  const ncrs = useModuleList<Ncr>("ncr", wantPlant && can("ncr"), siteId);
  const capas = useModuleList<Capa>("capa", wantPlant && can("capa"), siteId);
  const documents = useModuleList<AccuQualDocument>("documents", wantPlant && can("documents"), "shared", { status: "in_review" });
  const audits = useModuleList<Audit>("audits", wantPlant && can("audit"), siteId, { statusNot: "completed" });
  const { label } = usePersonDirectory();
  const { items } = useCalendarItems();
  const summary = summarizeCalendarItems(items);

  const fixIds = new Set((capas.data ?? []).map((capa) => capa.ncrId).filter((id): id is number => id != null));
  const openIssues = (ncrs.data ?? []).filter((ncr) => ncr.status !== "closed");
  const openFixes = (capas.data ?? []).filter((capa) => capa.status !== "closed");
  const inReview = (documents.data ?? []).filter((doc) => doc.status === "in_review");
  const upcomingAudits = (audits.data ?? []).filter((audit) => audit.status !== "completed");

  const late = lateItems([
    ...openIssues.map((ncr) => ({
      who: label(ncr.assignedTo),
      label: recordHeading("NCR", ncr.recordNumber),
      link: `/ncr/${ncr.id}`,
      due: ncr.dueDate,
      terminal: false,
    })),
    ...openFixes.map((capa) => ({
      who: label(capa.ownerId),
      label: recordHeading("CAPA", capa.recordNumber),
      link: `/capa/${capa.id}`,
      due: capa.dueDate,
      terminal: false,
    })),
  ]);

  const waiting = [
    ...openIssues
      .filter((ncr) => (ncr.status === "ncr_created" || ncr.status === "open") && !ncr.containment)
      .map((ncr) => ({ key: `ncr-${ncr.id}`, label: `${recordHeading("NCR", ncr.recordNumber)} — ${ncr.title}`, detail: "Still on NCR Created", link: `/ncr/${ncr.id}` })),
    ...openIssues
      .filter((ncr) => (ncr.status === "disposition" || ncr.status === "fix" || ncr.status === "verify" || ncr.status === "investigating" || ncr.status === "corrective_action") && !fixIds.has(ncr.id))
      .map((ncr) => ({ key: `link-${ncr.id}`, label: `${recordHeading("NCR", ncr.recordNumber)} — ${ncr.title}`, detail: "No CAPA linked yet", link: `/ncr/${ncr.id}` })),
    ...openFixes
      .filter((capa) => capa.status === "verifying" || capa.status === "open")
      .map((capa) => ({
        key: `capa-${capa.id}`,
        label: recordHeading("CAPA", capa.recordNumber),
        detail: capa.status === "open" ? "Not started" : "Waiting on the check",
        link: `/capa/${capa.id}`,
      })),
    ...inReview.map((doc) => ({ key: `doc-${doc.id}`, label: doc.title, detail: "Waiting on a reviewer", link: `/documents/${doc.id}` })),
  ].slice(0, 8);

  const nextIssue = openIssues.find((ncr) => isPastDue(ncr.dueDate, false)) ?? openIssues[0];
  const nextAudit = upcomingAudits[0];
  const nextDoc = inReview[0];

  const heading =
    kind === "lead" ? "What's stuck" : kind === "auditor" ? "Reviews and audits" : "Your work today";
  const sub = [plantName, rolePhrase(user?.roleName), departmentPhrase(user?.department)].filter(Boolean).join(" · ");

  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user?.name?.split(" ")[0];
  const lateCount = kind === "floor" ? summary.overdueCount : late.length;

  const allowed = (id: string) => {
    if (id === "hero" || id === "waiting-on-me" || id === "recent" || id === "kpis" || id === "onboarding" || id === "inbox" || id === "calendar") return true;
    if (id === "next") return kind !== "floor" && (can("ncr") || can("capa") || can("audit") || can("documents"));
    if (id === "whos-late" || id === "waiting") return kind === "lead" && (can("ncr") || can("capa") || can("documents"));
    if (id === "audits") return kind === "auditor" && can("audit");
    if (id === "documents") return kind === "auditor" && can("documents");
    if (id === "training") return (kind === "floor" || kind === "lead") && can("training");
    if (id === "attention") return kind !== "auditor" && can("calibration");
    return false;
  };
  const { shown } = useWorkspaceSurface("home", allowed);
  const sections: Record<string, ReactNode> = {
    "waiting-on-me": <WaitingOnMe />,
    recent: <RecentWork canStartNcr={can("ncr")} />,
    hero: (
      <Reveal>
        <div className="hero-surface rounded-2xl p-6 md:p-8">
          <div className="relative">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-primary">
              <span className="live-dot h-2 w-2 rounded-full bg-primary" /> {heading}
            </p>
            <h1 className="mt-2 text-3xl font-semibold md:text-4xl">
              {hello}
              {firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="mt-2 max-w-xl text-muted-foreground">
              {summary.openCount === 0
                ? "Nothing is on your list right now."
                : `${summary.openCount} ${summary.openCount === 1 ? "thing is" : "things are"} on your list${lateCount > 0 ? `, ${lateCount} late` : ", none late"}.`}
            </p>
            {sub && <p className="mt-3 text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </Reveal>
    ),
    kpis: (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiTile index={1} label="On your list" value={summary.openCount} tone="primary" />
        <KpiTile index={2} label="Late" value={lateCount} tone={lateCount > 0 ? "danger" : "success"} sub={lateCount > 0 ? "Past their due date" : "All on schedule"} />
        <KpiTile index={3} label={kind === "auditor" ? "In review" : "Waiting"} value={kind === "auditor" ? inReview.length : waiting.length} tone="warning" />
        <KpiTile index={4} label="Done this month" value={summary.completedThisMonthCount} tone="success" />
      </div>
    ),
    next: <NextCallout kind={kind} issue={nextIssue} hasFix={nextIssue ? fixIds.has(nextIssue.id) : false} audit={nextAudit} doc={nextDoc} who={nextIssue ? label(nextIssue.assignedTo) : ""} />,
    "whos-late": (
      <NamedList
        title="Who's late"
        empty="Nobody is past a due date."
        rows={late.slice(0, 8).map((row) => ({ key: row.link, href: row.link, label: row.label, detail: `${row.who} · due ${row.due}` }))}
      />
    ),
    waiting: <NamedList title="Waiting on a step" empty="Nothing is sitting between steps." rows={waiting.map((row) => ({ key: row.key, href: row.link, label: row.label, detail: row.detail }))} />,
    audits: (
      <NamedList
        title="Audits still open"
        empty="No audits are scheduled or in progress."
        rows={upcomingAudits.slice(0, 8).map((audit) => ({
          key: `audit-${audit.id}`,
          href: `/audits/${audit.id}`,
          label: audit.name,
          detail: statusPhrase(audit.status),
        }))}
      />
    ),
    documents: (
      <NamedList
        title="Documents in review"
        empty="No document is waiting on a reviewer."
        rows={inReview.slice(0, 8).map((doc) => ({ key: `doc-${doc.id}`, href: `/documents/${doc.id}`, label: doc.title, detail: "In review" }))}
      />
    ),
    training: <TrainingAttentionStrip />,
    onboarding: <OnboardingChecklist />,
    attention: <AttentionStrip />,
    inbox: (
      <WorkflowInbox
        title={kind === "floor" ? "Assigned to you" : "Your next actions"}
        emptyMessage={
          kind === "floor"
            ? "Nothing is assigned to you. Issues and training show up here when someone sends them your way."
            : "Nothing on your own list. Plant-wide items that are late or waiting are above."
        }
      />
    ),
    calendar: <MonthCalendar compact />,
  };
  const homeLabels: Record<string, string> = {
    hero: "Greeting",
    "waiting-on-me": "WAITING ON ME",
    recent: "Recent and new",
    kpis: "Counts",
    next: "Next step",
    "whos-late": "Who's late",
    waiting: "Waiting on a step",
    audits: "Audits still open",
    documents: "Documents in review",
    training: "Training",
    onboarding: "Getting started",
    attention: "Equipment",
    inbox: "Your next actions",
    calendar: "Calendar",
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {hello}
        {firstName ? `, ${firstName}` : ""}. Open work assigned to you is first.
        {sub ? ` ${sub}` : ""}
      </p>
      {Math.max(ncrs.dataUpdatedAt, capas.dataUpdatedAt, documents.dataUpdatedAt, audits.dataUpdatedAt) > 0 && (
        <UpdatedStamp at={new Date(Math.max(ncrs.dataUpdatedAt, capas.dataUpdatedAt, documents.dataUpdatedAt, audits.dataUpdatedAt))} />
      )}
      <WorkspaceArrange surface="home" labels={homeLabels} allowed={allowed} footer={<KpiChartCustomize surface="home" />} />
      <KpiPinnedCharts surface="home" />
      {pairSections(shown, sections)}
    </div>
  );
}

function RecentWork({ canStartNcr }: { canStartNcr: boolean }) {
  const rows = useRecentRecords();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold tracking-wide">RECENT</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Records you open show up here.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.path} className="border-t border-border">
                  <td className="w-28 py-1.5 text-muted-foreground">{row.type}</td>
                  <td className="py-1.5">
                    <Link to={row.path} title={row.title} className="block truncate font-medium text-primary hover:underline">
                      {row.title}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold tracking-wide">NEW</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          <li>
            <Link to={blankFormsFolderHref()} className="text-primary hover:underline">
              Blank form
            </Link>
          </li>
          {canStartNcr && (
            <li>
              <Link to={FRM_NCR_PATH} className="text-primary hover:underline">
                FRM NCR
              </Link>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

const HOME_PAIRS = new Set(["whos-late|waiting", "waiting|whos-late", "audits|documents", "documents|audits", "inbox|calendar", "calendar|inbox"]);

function pairSections(shown: string[], sections: Record<string, ReactNode>) {
  const nodes: ReactNode[] = [];
  for (let index = 0; index < shown.length; index += 1) {
    const id = shown[index]!;
    const next = shown[index + 1];
    if (next && HOME_PAIRS.has(`${id}|${next}`)) {
      nodes.push(
        <div key={`${id}-${next}`} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sections[id]}
          {sections[next]}
        </div>,
      );
      index += 1;
    } else {
      nodes.push(<Fragment key={id}>{sections[id]}</Fragment>);
    }
  }
  return nodes;
}

function NextCallout({
  kind,
  issue,
  hasFix,
  audit,
  doc,
  who,
}: {
  kind: HomeKind;
  issue?: Ncr;
  hasFix: boolean;
  audit?: Audit;
  doc?: AccuQualDocument;
  who: string;
}) {
  if (kind === "auditor" && audit) {
    return (
      <Callout
        kicker="Next"
        title={audit.name}
        detail={`${statusPhrase(audit.status)}. Open it and record what you find.`}
        href={`/audits/${audit.id}`}
      />
    );
  }
  if (kind === "auditor" && doc) {
    return <Callout kicker="Next" title={doc.title} detail="This document is waiting on a reviewer." href={`/documents/${doc.id}`} />;
  }
  if (issue) {
    return (
      <Callout
        kicker="Next"
        title={`${recordHeading("NCR", issue.recordNumber)} — ${issue.title}`}
        detail={`${ncrNextAction(issue.status, hasFix)} ${who === "Unassigned" ? "Nobody owns it yet." : `${who} owns it.`}`}
        href={`/ncr/${issue.id}`}
      />
    );
  }
  if (doc) {
    return <Callout kicker="Next" title={doc.title} detail="Waiting on a reviewer." href={`/documents/${doc.id}`} />;
  }
  return null;
}

function Callout({ kicker, title, detail, href }: { kicker: string; title: string; detail: string; href: string }) {
  return (
    <Reveal index={5}>
      <Link
        to={href}
        className="kpi-tile kpi-hover group flex items-center justify-between gap-4 rounded-xl p-5"
        style={{ ["--tone" as string]: "var(--primary)" }}
      >
        <span className="relative min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-widest text-primary">{kicker}</span>
          <span className="mt-1 block truncate text-lg font-semibold" title={title}>{title}</span>
          <span className="block text-sm text-muted-foreground">{detail}</span>
        </span>
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform group-hover:translate-x-1">
          <ArrowRight size={18} />
        </span>
      </Link>
    </Reveal>
  );
}

function NamedList({ title, empty, rows }: { title: string; empty: string; rows: { key: string; href: string; label: string; detail: string }[] }) {
  return (
    <Reveal index={6}>
      <div className="h-full rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold">{title}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <li key={row.key}>
                <Link to={row.href} title={row.label} className="group flex items-center gap-3 rounded-lg p-2.5 hover:bg-muted/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" title={row.label}>{row.label}</span>
                    <span className="block truncate text-xs text-muted-foreground" title={row.detail}>{row.detail}</span>
                  </span>
                  <ChevronRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Reveal>
  );
}

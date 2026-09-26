import { Link } from "react-router-dom";
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

function useModuleList<T>(resource: string, enabled: boolean, siteKey: number | null | "shared") {
  return useQuery({
    queryKey: [resource, siteKey, undefined],
    queryFn: async () => (await apiClient.get<T[]>(`/${resource}`)).data,
    enabled,
    staleTime: 30_000,
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
  const bypass = user?.roleName === "admin";
  const ready = bypass || !permsLoading;
  const can = (key: string) => ready && (bypass || (!!effective && effective[key] !== undefined && effective[key] !== "none"));

  const wantPlant = kind === "lead" || kind === "auditor";
  const ncrs = useModuleList<Ncr>("ncr", wantPlant && can("ncr"), siteId);
  const capas = useModuleList<Capa>("capa", wantPlant && can("capa"), siteId);
  const documents = useModuleList<AccuQualDocument>("documents", wantPlant && can("documents"), "shared");
  const audits = useModuleList<Audit>("audits", wantPlant && can("audit"), siteId);
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
      label: `Issue #${ncr.id}`,
      link: `/ncr/${ncr.id}`,
      due: ncr.dueDate,
      terminal: false,
    })),
    ...openFixes.map((capa) => ({
      who: label(capa.ownerId),
      label: `Fix #${capa.id}`,
      link: `/capa/${capa.id}`,
      due: capa.dueDate,
      terminal: false,
    })),
  ]);

  const waiting = [
    ...openIssues
      .filter((ncr) => ncr.status === "open" && !ncr.containment)
      .map((ncr) => ({ key: `ncr-${ncr.id}`, label: `Issue #${ncr.id} — ${ncr.title}`, detail: "Not contained yet", link: `/ncr/${ncr.id}` })),
    ...openIssues
      .filter((ncr) => (ncr.status === "investigating" || ncr.status === "corrective_action") && !fixIds.has(ncr.id))
      .map((ncr) => ({ key: `link-${ncr.id}`, label: `Issue #${ncr.id} — ${ncr.title}`, detail: "No fix linked yet", link: `/ncr/${ncr.id}` })),
    ...openFixes
      .filter((capa) => capa.status === "verifying" || capa.status === "open")
      .map((capa) => ({
        key: `capa-${capa.id}`,
        label: `Fix #${capa.id}`,
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

  return (
    <div className="flex flex-col gap-8">
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiTile index={1} label="On your list" value={summary.openCount} tone="primary" />
        <KpiTile index={2} label="Late" value={lateCount} tone={lateCount > 0 ? "danger" : "success"} sub={lateCount > 0 ? "Past their due date" : "All on schedule"} />
        <KpiTile index={3} label={kind === "auditor" ? "In review" : "Waiting"} value={kind === "auditor" ? inReview.length : waiting.length} tone="warning" />
        <KpiTile index={4} label="Done this month" value={summary.completedThisMonthCount} tone="success" />
      </div>

      {kind !== "floor" && <NextCallout kind={kind} issue={nextIssue} hasFix={nextIssue ? fixIds.has(nextIssue.id) : false} audit={nextAudit} doc={nextDoc} who={nextIssue ? label(nextIssue.assignedTo) : ""} />}

      {kind === "lead" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <NamedList
            title="Who's late"
            empty="Nobody is past a due date."
            rows={late.slice(0, 8).map((row) => ({ key: row.link, href: row.link, label: row.label, detail: `${row.who} · due ${row.due}` }))}
          />
          <NamedList title="Waiting on a step" empty="Nothing is sitting between steps." rows={waiting.map((row) => ({ key: row.key, href: row.link, label: row.label, detail: row.detail }))} />
        </div>
      )}

      {kind === "auditor" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
          <NamedList
            title="Documents in review"
            empty="No document is waiting on a reviewer."
            rows={inReview.slice(0, 8).map((doc) => ({ key: `doc-${doc.id}`, href: `/documents/${doc.id}`, label: doc.title, detail: "In review" }))}
          />
        </div>
      )}

      {kind === "floor" && <TrainingAttentionStrip />}
      <OnboardingChecklist />
      {kind === "lead" && <TrainingAttentionStrip />}
      {kind !== "auditor" && <AttentionStrip />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WorkflowInbox
          title={kind === "floor" ? "Assigned to you" : "Your next actions"}
          emptyMessage={
            kind === "floor"
              ? "Nothing is assigned to you. Issues and training show up here when someone sends them your way."
              : "Nothing on your own list. Plant-wide items that are late or waiting are above."
          }
        />
        <MonthCalendar compact />
      </div>
    </div>
  );
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
        title={`Issue #${issue.id} — ${issue.title}`}
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
          <span className="mt-1 block truncate text-lg font-semibold">{title}</span>
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
                <Link to={row.href} className="group flex items-center gap-3 rounded-lg p-2.5 hover:bg-muted/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>
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

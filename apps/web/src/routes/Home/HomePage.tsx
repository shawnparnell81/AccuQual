import { useCurrentTenant } from "../../hooks/useAuth";
import { UserDashboardHeader } from "../../components/home/UserDashboardHeader";
import { WorkflowInbox } from "../../components/home/WorkflowInbox";
import { MonthCalendar } from "../../components/calendar/MonthCalendar";
import { AttentionStrip } from "../../components/calibration/EquipmentPanels";
import { TrainingAttentionStrip } from "../../components/training/TrainingPanels";

/**
 * The tenant portal's landing page at /home. Real per-user data throughout
 * (see UserDashboardHeader/WorkflowInbox, both fed by GET /calendar) — the
 * earlier placeholder module-tile grid is gone; "what module do I want" is
 * now the top nav's Modules dropdown (TopNav.tsx's ModulesDropdown), and
 * "what needs my attention" is this page's own job. The real Dashboard (KPI
 * counts, charts, etc.) is unchanged and still lives at "/" — this stays a
 * separate, distinct entry point, not a replacement for it.
 *
 * "My Day" consolidation: Calibration's and Training's own attention strips
 * are separate systems from the calendar aggregator above (they don't run
 * through GET /calendar) — folded in here rather than building a fourth
 * aggregator. Both already render nothing at all when their list is empty
 * OR when the caller lacks that module's read permission (their own query
 * just returns no rows on a 403 — see each component's own code), so a
 * user missing calibration or training access simply never sees that
 * strip; nothing here needs its own extra permission check.
 */
export function HomePage() {
  const tenant = useCurrentTenant();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <img src="/branding/logo-mark.png" alt="" className="h-10 w-10 rounded-md object-cover" />
        <div>
          <h1 className="text-lg font-semibold leading-tight">AccuQual QMS</h1>
          {tenant && <p className="text-sm text-muted-foreground leading-tight">{tenant.name}</p>}
        </div>
      </div>

      <UserDashboardHeader />
      <AttentionStrip />
      <TrainingAttentionStrip />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WorkflowInbox />
        <MonthCalendar compact />
      </div>
    </div>
  );
}

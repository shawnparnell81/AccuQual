import { OpenFormButton } from "../../components/forms/OpenFormButton";

/**
 * Both logs are company-wide rosters — one continuous document each, not
 * records per work order — so unlike every other module here there's no
 * list of rows to click into. Both open as a fixed singleton document
 * (entityId 1) scoped by formType alone; each company gets exactly one of each.
 */
const SINGLETON_ENTITY_ID = 1;

export function ProductionLogsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Production Logs</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Master Production Log</h2>
          <p className="text-sm text-muted-foreground">
            Shop-floor fulfillment tracker across every work order — order &amp; traceability info, planning &amp;
            scheduling, shop-floor execution and yield, and quality/shipping status, with Yield % calculated
            automatically.
          </p>
          <OpenFormButton
            formType="production_log"
            entityId={SINGLETON_ENTITY_ID}
            title="Master Production Log"
            label="Open Master Production Log"
          />
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Daily Production &amp; Quality Log</h2>
          <p className="text-sm text-muted-foreground">
            Per-shift traceability record — operator, work order, lot/batch, quantities produced/accepted/rejected,
            and in-process sign-off.
          </p>
          <OpenFormButton
            formType="daily_production_log"
            entityId={SINGLETON_ENTITY_ID}
            title="Daily Production & Quality Log"
            label="Open Daily Production Log"
          />
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Production &amp; Operational Output Log</h2>
          <p className="text-sm text-muted-foreground">
            Hourly tracking matrix by work cell/line and shift — target vs. actual output, scrap, and defect
            breakdown, with Net Yield calculated automatically.
          </p>
          <OpenFormButton
            formType="production_output_log"
            entityId={SINGLETON_ENTITY_ID}
            title="Production & Operational Output Log"
            label="Open Output Log"
          />
        </div>
      </div>
    </div>
  );
}

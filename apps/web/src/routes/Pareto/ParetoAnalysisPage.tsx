import { OpenFormButton } from "../../components/forms/OpenFormButton";

/** A standalone analysis tool, not tied to any other record — a fixed singleton document, same pattern as the Production Logs page. */
const SINGLETON_ENTITY_ID = 1;

export function ParetoAnalysisPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Pareto Analysis</h1>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Pareto Chart</h2>
        <p className="text-sm text-muted-foreground">
          Log problem counts, and the chart sorts them by frequency and calculates the cumulative % line
          automatically — the 80/20 view of which few problems drive most of the defects.
        </p>
        <OpenFormButton formType="pareto_chart" entityId={SINGLETON_ENTITY_ID} title="Pareto Chart" label="Open Pareto Chart" />
      </div>
    </div>
  );
}

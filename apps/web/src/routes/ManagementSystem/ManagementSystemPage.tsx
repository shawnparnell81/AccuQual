import { OpenFormButton } from "../../components/forms/OpenFormButton";

/**
 * Both documents are periodic/point-in-time corporate records rather than
 * per-record entities with their own list — modeled as fixed singletons
 * (the "current" context analysis, the "current" review), same
 * simplification as the Production Logs page. A tenant that wants a dated
 * history of past management reviews would need a real list/detail module
 * instead; flagged as a simplification, not attempted here.
 */
const SINGLETON_ENTITY_ID = 1;

export function ManagementSystemPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Management System</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Context of the Organization</h2>
          <p className="text-sm text-muted-foreground">
            ISO 9001 clause 4.1 SWOT-style analysis — internal strengths/weaknesses and external
            opportunities/threats, by interested party.
          </p>
          <OpenFormButton
            formType="context_of_organization"
            entityId={SINGLETON_ENTITY_ID}
            title="Context of the Organization"
            label="Open Context of the Organization"
          />
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Management Review</h2>
          <p className="text-sm text-muted-foreground">
            Management system performance evaluation — strategic core review inputs and the action items
            they produce.
          </p>
          <OpenFormButton
            formType="management_review"
            entityId={SINGLETON_ENTITY_ID}
            title="Management System Performance Evaluation Record"
            label="Open Management Review"
          />
        </div>
      </div>
    </div>
  );
}

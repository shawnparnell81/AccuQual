import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { OpenFormButton } from "../../components/forms/OpenFormButton";

/**
 * Context of the Organization and Management Review are version-controlled: each has one record per
 * organization, and what everyone reads is its published version. Changes are made on a draft that a
 * reviewer approves (see ControlledDocumentPage). The two minutes forms below remain plain singletons.
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
          <Link to="/management-system/context" className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            <FileText size={16} /> Open Context of the Organization
          </Link>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Management Review</h2>
          <p className="text-sm text-muted-foreground">
            Management system performance evaluation — strategic core review inputs and the action items
            they produce.
          </p>
          <Link to="/management-system/management-review" className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            <FileText size={16} /> Open Management Review
          </Link>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Executive Governance Minutes</h2>
          <p className="text-sm text-muted-foreground">
            Strategic management review & resource allocation minutes — executive attendance, strategic
            performance inputs, and downstream action tracking.
          </p>
          <OpenFormButton
            formType="management_review_minutes"
            entityId={SINGLETON_ENTITY_ID}
            title="Executive Governance & System Performance Record"
            label="Open Executive Governance Minutes"
          />
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Monthly Staff Meeting Minutes</h2>
          <p className="text-sm text-muted-foreground">
            Operational staff & cross-functional alignment log — safety, operational metrics, quality alerts,
            training updates, and plant floor action items.
          </p>
          <OpenFormButton
            formType="staff_meeting_minutes"
            entityId={SINGLETON_ENTITY_ID}
            title="Operational Staff & Cross-Functional Alignment Log"
            label="Open Staff Meeting Minutes"
          />
        </div>
      </div>
    </div>
  );
}

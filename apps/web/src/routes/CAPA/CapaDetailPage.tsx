import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Capa } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextAreaField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { PrintFormButton } from "../../components/forms/PrintFormButton";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";

const capaHooks = createResourceHooks<Capa>("capa");

interface CapaGeneratedPlan {
  actionPlan: string;
  preventiveAction: string;
  verification: string;
  estimatedClosureDays: number;
}

/** CAPA Detail: root cause summary, action plan, verification steps, AI-generated recommendations, history. */
export function CapaDetailPage() {
  const { id } = useParams();
  const capaId = Number(id);
  const historyKey: unknown[][] = [["workflow-history", "capa", capaId]];
  const { data: capa, isLoading, isError } = capaHooks.useOne(capaId);
  useSetAssistantContext("capa", capaId, `CAPA #${capaId}`);
  const updateCapa = capaHooks.useUpdate();
  // Sprint 2 fix — Open -> In Progress now has a real dedicated, guarded
  // endpoint (POST /capa/:id/start), same as verify/close below, instead of
  // the generic PATCH this used to go through.
  const startAction = useWorkflowAction("capa", "start", { successMessage: "CAPA started.", invalidateKeys: historyKey });
  const verifyAction = useWorkflowAction("capa", "verify", { successMessage: "Verification recorded.", invalidateKeys: historyKey });
  const closeAction = useWorkflowAction("capa", "close", { successMessage: "CAPA closed.", invalidateKeys: historyKey });
  const [verification, setVerification] = useState("");
  // Phase 11 bug fix — this field was write-only local draft state with no
  // hydration from the record at all: a CAPA already verified (status
  // "verifying" or "closed") showed an empty box here forever, even though
  // capa.verification really does hold the submitted text (confirmed live —
  // every other field on this page binds directly to the record; this was
  // the one exception). Kept as separate local state rather than switching
  // to the direct capa.X-binding pattern those other fields use, since
  // verification submits through its own /capa/:id/verify transition
  // endpoint, not a plain PATCH-on-every-keystroke.
  useEffect(() => {
    if (capa?.verification) setVerification(capa.verification);
  }, [capa?.verification]);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !capa) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">CAPA #{capa.id}</h1>
          <StatusBadge value={capa.status} />
        </div>
        <div className="flex gap-2">
          <OpenFormButton formType="capa" entityId={capa.id} title={`CAPA #${capa.id} Form`} />
          <PrintFormButton formType="capa" entityId={capa.id} />
          <WorkflowActionButton
            label="Start Work"
            navKey="capa"
            action={startAction}
            onClick={() => startAction.mutate({ id: capaId })}
            visible={capa.status === "open"}
            variant="primary"
          />
          <WorkflowActionButton
            label="Close CAPA"
            navKey="capa"
            action={closeAction}
            onClick={() => closeAction.mutate({ id: capaId })}
            visible={capa.status === "verifying"}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Root Cause Summary</h2>
            <AiFieldAssistant
              module="capa"
              recordId={capaId}
              triggerLabel="AI Root Cause Analysis"
              buildInitialPrompt={() =>
                `Analyze the probable root cause for CAPA #${capaId}${capa.ncrId ? ` (linked to NCR #${capa.ncrId})` : ""}. ` +
                "Walk through a 5-Why analysis, note which Fishbone (Ishikawa) categories are most likely involved (e.g. method, machine," +
                " material, man, measurement, environment), and conclude with the single most probable root cause and a short list of" +
                " recommended corrective actions. This is a draft analysis for a quality engineer to review, not a final record."
              }
              onInsert={(text) => updateCapa.mutate({ id: capaId, rootCause: text })}
              insertLabel="Insert as Root Cause"
            />
          </div>
          <TextAreaField
            label=""
            value={capa.rootCause ?? ""}
            placeholder="Not yet documented."
            onChange={(e) => updateCapa.mutate({ id: capaId, rootCause: e.target.value })}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Action Plan</h2>
          <TextAreaField
            label=""
            value={capa.actionPlan ?? ""}
            onChange={(e) => updateCapa.mutate({ id: capaId, actionPlan: e.target.value })}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Preventive Action</h2>
          <TextAreaField
            label=""
            value={capa.preventiveAction ?? ""}
            onChange={(e) => updateCapa.mutate({ id: capaId, preventiveAction: e.target.value })}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Verification Steps</h2>
          {capa.status === "open" ? (
            <p className="text-sm text-muted-foreground">Start work above first — verification can't be recorded before that.</p>
          ) : (
            <>
              <TextAreaField label="" value={verification} onChange={(e) => setVerification(e.target.value)} readOnly={capa.status !== "in_progress"} />
              <WorkflowActionButton
                label="Submit verification"
                navKey="capa"
                action={verifyAction}
                onClick={() => verifyAction.mutate({ id: capaId, verification })}
                visible={capa.status === "in_progress"}
                variant="primary"
              />
            </>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">AI Effectiveness Score</h2>
            <AiFieldAssistant
              module="capa_effectiveness"
              recordId={capaId}
              triggerLabel="AI Effectiveness Score"
              buildInitialPrompt={() =>
                `Score the effectiveness of CAPA #${capaId} on a 0–100 scale. Base the score on how well-documented and complete the root` +
                " cause, action plan, preventive action, and verification are, and on any recurrence signal noted in the context below." +
                " Respond with: the effectiveness score (0–100), a short reasoning summary for that score, a few recommended follow-up" +
                " actions, and an assessment of the risk of recurrence (low/medium/high with a one-line justification)."
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Scores this CAPA's documentation and verification completeness and estimates recurrence risk — an insight for the CAPA owner
            to weigh, not a field on this record.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">AI-Generated CAPA Recommendations</h2>
            <AiStructuredSuggestion<CapaGeneratedPlan>
              endpoint="/ai/capa"
              title="AI-Drafted CAPA Content"
              triggerLabel="Generate Recommendations"
              acceptLabel="Use This Draft"
              buildPayload={() => ({ ncrId: capa.ncrId, rootCause: capa.rootCause, ncrData: capa })}
              onAccept={(output) => {
                // actionPlan/preventiveAction are plain PATCH-able fields;
                // verification is NOT (see capa.validation.ts's separate,
                // stricter verifyCapaSchema on the dedicated /verify
                // endpoint) — land it in the same local draft state the
                // Verification Steps textarea below already uses, so the
                // user still explicitly reviews and submits it themselves.
                updateCapa.mutate({ id: capaId, actionPlan: output.actionPlan, preventiveAction: output.preventiveAction });
                setVerification(output.verification);
              }}
              renderPreview={(output) => (
                <div className="flex flex-col gap-3 text-sm">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Action Plan</p>
                    <p>{output.actionPlan}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Preventive Action</p>
                    <p>{output.preventiveAction}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Verification</p>
                    <p>{output.verification}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Estimated closure: {output.estimatedClosureDays} days</p>
                </div>
              )}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Accepting fills in the Action Plan, Preventive Action, and Verification fields above — review and edit them before this CAPA
            moves forward.
          </p>
        </div>
      </div>

      <AttachmentsPanel entityType="capa" entityId={capaId} />
      <WorkflowHistoryPanel moduleName="capa" recordId={capaId} />
    </div>
  );
}

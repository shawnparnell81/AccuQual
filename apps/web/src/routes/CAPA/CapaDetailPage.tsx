import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Capa } from "../../api/types";
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
import { LoopTrail, RecordGlance } from "../../components/records/RecordStatus";
import { CAPA_LOOP, READ_ONLY_REASON, capaLoopIndex, capaNextAction, duePhrase, isPastDue, statusPhrase } from "../../lib/opsLanguage";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { usePersonDirectory } from "../../hooks/usePersonDirectory";

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
  const canEdit = useCanEditWorkflow("capa");
  const { label, people } = usePersonDirectory();
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

  if (isError) return <p className="text-sm text-destructive">Couldn't load this fix. Refresh the page and try again.</p>;
  if (isLoading || !capa) return <p className="text-sm text-muted-foreground">Loading this fix…</p>;

  const owner = label(capa.ownerId);
  const closed = capa.status === "closed";

  return (
    <div className="flex flex-col gap-4">
      <RecordGlance
        crumbs={[
          { label: "Fixes", to: "/capa" },
          ...(capa.ncrId ? [{ label: `Issue #${capa.ncrId}`, to: `/ncr/${capa.ncrId}` }] : []),
          { label: `Fix #${capa.id}` },
        ]}
        title={`Fix #${capa.id}`}
        standard="CAPA"
        stateValue={capa.status}
        stateLabel={statusPhrase(capa.status)}
        owner={owner}
        ownerControl={
          canEdit && people.length > 0 ? (
            <select
              aria-label="Owner"
              value={capa.ownerId ?? ""}
              onChange={(e) => {
                if (!e.target.value) return;
                updateCapa.mutate({ id: capaId, ownerId: Number(e.target.value) });
              }}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              {!capa.ownerId && <option value="">Unassigned</option>}
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name?.trim() || person.email}
                </option>
              ))}
            </select>
          ) : undefined
        }
        due={duePhrase(capa.dueDate, closed)}
        dueLate={isPastDue(capa.dueDate, closed)}
        dueControl={
          canEdit ? (
            <input
              type="date"
              aria-label="Due date"
              value={capa.dueDate ? capa.dueDate.slice(0, 10) : ""}
              onChange={(e) => updateCapa.mutate({ id: capaId, dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          ) : undefined
        }
        blocked={closed ? "Nobody" : owner === "Unassigned" ? "Nobody is assigned" : owner}
        next={capaNextAction(capa.status)}
        accessNote={canEdit ? null : READ_ONLY_REASON}
        actions={
          <>
            <OpenFormButton formType="capa" entityId={capa.id} title={`CAPA #${capa.id} Form`} />
            <PrintFormButton formType="capa" entityId={capa.id} />
            <WorkflowActionButton
              label="Start the work"
              navKey="capa"
              action={startAction}
              onClick={() => startAction.mutate({ id: capaId })}
              visible={capa.status === "open"}
              variant="primary"
            />
            <WorkflowActionButton
              label="Close the fix"
              navKey="capa"
              action={closeAction}
              onClick={() => closeAction.mutate({ id: capaId })}
              visible={capa.status === "verifying"}
            />
          </>
        }
        trail={<LoopTrail steps={CAPA_LOOP} current={capaLoopIndex(capa.status)} />}
      />
      <p className="text-sm text-muted-foreground">
        {capa.ncrId ? (
          <>
            Opened from <Link to={`/ncr/${capa.ncrId}`} className="text-primary hover:underline">issue #{capa.ncrId}</Link>.
          </>
        ) : (
          <>This fix isn't tied to an issue yet. Link it from the issue so containment, the fix, and the check stay one story.</>
        )}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Cause</h2>
            {canEdit && <AiFieldAssistant
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
            />}
          </div>
          <TextAreaField
            label=""
            value={capa.rootCause ?? ""}
            placeholder="Not written yet."
            readOnly={!canEdit}
            onChange={(e) => canEdit && updateCapa.mutate({ id: capaId, rootCause: e.target.value })}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">What you'll do</h2>
          <TextAreaField
            label=""
            value={capa.actionPlan ?? ""}
            readOnly={!canEdit}
            onChange={(e) => canEdit && updateCapa.mutate({ id: capaId, actionPlan: e.target.value })}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">How you'll keep it from coming back</h2>
          <TextAreaField
            label=""
            value={capa.preventiveAction ?? ""}
            readOnly={!canEdit}
            onChange={(e) => canEdit && updateCapa.mutate({ id: capaId, preventiveAction: e.target.value })}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Did the fix work?</h2>
          {capa.status === "open" ? (
            <p className="text-sm text-muted-foreground">Start the work above first. You can't check the fix before that.</p>
          ) : (
            <>
              {!capa.verification && capa.status === "in_progress" && (
                <p className="mb-2 text-sm text-muted-foreground">Nothing recorded yet. Write what you checked, then submit it.</p>
              )}
              <TextAreaField label="" value={verification} onChange={(e) => setVerification(e.target.value)} readOnly={!canEdit || capa.status !== "in_progress"} />
              <WorkflowActionButton
                label="Submit the check"
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
            <h2 className="text-sm font-medium">How solid is this writeup?</h2>
            {canEdit && <AiFieldAssistant
              module="capa_effectiveness"
              recordId={capaId}
              triggerLabel="AI Effectiveness Score"
              buildInitialPrompt={() =>
                `Score the effectiveness of CAPA #${capaId} on a 0–100 scale. Base the score on how well-documented and complete the root` +
                " cause, action plan, preventive action, and verification are, and on any recurrence signal noted in the context below." +
                " Respond with: the effectiveness score (0–100), a short reasoning summary for that score, a few recommended follow-up" +
                " actions, and an assessment of the risk of recurrence (low/medium/high with a one-line justification)."
              }
            />}
          </div>
          <p className="text-xs text-muted-foreground">
            Scores this CAPA's documentation and verification completeness and estimates recurrence risk — an insight for the CAPA owner
            to weigh, not a field on this record.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Draft a plan</h2>
            {canEdit && <AiStructuredSuggestion<CapaGeneratedPlan>
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
            />}
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

import { useEffect, useRef, useState } from "react";
import { SaveStatus } from "../../components/shared/SaveStatus";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { RecordAccessMessage } from "../../components/shared/RecordAccessMessage";
import { Link, useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Capa, Ncr } from "../../api/types";
import { TextAreaField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";
import { LoopTrail, RecordGlance } from "../../components/records/RecordStatus";
import { RecordNumberEditor } from "../../components/forms/RecordNumberField";
import { RecordSiteField } from "../../components/records/RecordSiteField";
import { recordHeading } from "../../lib/userRecordNumber";
import { capaStepFieldEditable, textStillDirty, type CapaNarrativeField } from "../../lib/capaStep";
import { CAPA_LOOP, READ_ONLY_REASON, capaLoopIndex, capaNextAction, duePhrase, formatPerson, isPastDue, peopleForAssignment, statusPhrase } from "../../lib/opsLanguage";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { useModuleFormLock } from "../../hooks/useSavedFormMode";
import { ModuleFormLock } from "../../components/forms/SavedFormLockBar";
import { usePersonDirectory } from "../../hooks/usePersonDirectory";
import { PictureRecordProvider } from "../../components/forms/pictureRecord";
import { PictureBoundText } from "../../components/forms/PictureText";

const capaHooks = createResourceHooks<Capa>("capa");
const ncrHooks = createResourceHooks<Ncr>("ncr");

function StepNote({ editable }: { editable: boolean }) {
  return (
    <p className={`mb-2 text-xs ${editable ? "font-medium text-foreground" : "text-muted-foreground"}`} data-step-editable={editable ? "yes" : "no"}>
      {editable ? "Type in this box. This step does not need Edit first." : "This box opens when the CAPA reaches its step."}
    </p>
  );
}

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
  const permitted = useCanEditWorkflow("capa");
  const formLock = useModuleFormLock(capaId, permitted, `/capa/${capaId}/begin-edit`);
  const canEdit = formLock.fieldsEditable;
  const { label, people } = usePersonDirectory();
  const { data: capa, isLoading, isError, error } = capaHooks.useOne(capaId);
  const { data: linkedNcr } = ncrHooks.useOne(capa?.ncrId ?? undefined);
  useSetAssistantContext("capa", capaId, capa ? recordHeading("CAPA", capa.recordNumber) : "CAPA");
  const updateCapa = capaHooks.useUpdate();
  const rootCommit = useRef<(() => void) | null>(null);
  const planCommit = useRef<(() => void) | null>(null);
  const preventCommit = useRef<(() => void) | null>(null);
  const [pendingNarrative, setPendingNarrative] = useState<Record<string, boolean>>({});
  const narrativeDirty = Object.values(pendingNarrative).some(Boolean);
  function noteNarrative(key: string) {
    return (value: string | null) => setPendingNarrative((current) => ({ ...current, [key]: value != null }));
  }
  function flushNarrative() {
    rootCommit.current?.();
    planCommit.current?.();
    preventCommit.current?.();
  }
  const startAction = useWorkflowAction("capa", "start", { successMessage: "CAPA started.", invalidateKeys: historyKey });
  const verifyAction = useWorkflowAction("capa", "verify", { successMessage: "Verification recorded.", invalidateKeys: historyKey });
  const closeAction = useWorkflowAction("capa", "close", { successMessage: "CAPA closed.", invalidateKeys: historyKey });
  const [verification, setVerification] = useState("");
  const [verificationTouched, setVerificationTouched] = useState(false);
  // Local draft because verify posts to /capa/:id/verify, not a field PATCH.
  // Seed it from the saved note so a verifying or closed CAPA is not a blank box.
  useEffect(() => {
    setVerification(capa?.verification ?? "");
    setVerificationTouched(false);
  }, [capa?.verification]);

  if (isError) return <RecordAccessMessage error={error} fallback="Couldn't load this CAPA. Refresh the page and try again." noun="this CAPA" />;
  if (isLoading || !capa) return <LoadingPlaceholder />;

  const owner = label(capa.ownerId);
  const closed = capa.status === "closed";
  const stepField = (field: CapaNarrativeField) => capaStepFieldEditable(capa.status, field, permitted);
  const narrativeClass = "w-full rounded-[9px] border border-form-field bg-[hsl(var(--form-input))] px-2.5 py-2 text-sm text-[hsl(var(--form-input-foreground))] outline-none focus:border-ring";

  return (
    <PictureRecordProvider entityType="capa" entityId={capaId}>
    <div className="flex flex-col gap-4">
      <RecordGlance
        crumbs={[
          { label: "CAPA", to: "/capa" },
          ...(capa.ncrId ? [{ label: "Linked NCR", to: `/ncr/${capa.ncrId}` }] : []),
          { label: recordHeading("CAPA", capa.recordNumber) },
        ]}
        title={recordHeading("CAPA", capa.recordNumber)}
        numberControl={
          <>
            <RecordNumberEditor
              label="CAPA No."
              value={capa.recordNumber}
              canEdit={canEdit}
              onSave={(next) => updateCapa.mutateAsync({ id: capaId, recordNumber: next.trim() || null })}
            />
            <RecordSiteField entity="capa" id={capaId} canEdit={canEdit} />
          </>
        }
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
              {peopleForAssignment(people, capa.ownerId).map((person) => (
                <option key={person.id} value={person.id}>
                  {formatPerson(person)}
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
        accessNote={permitted ? null : READ_ONLY_REASON}
        actions={
          <>
            <ModuleFormLock mode={formLock.mode} canEdit={permitted} pending={updateCapa.isPending} onEdit={() => formLock.onEdit()} onSave={flushNarrative} onLock={formLock.lock} />
            <DeleteRecordButton resource="capa" id={capaId} kind="CAPA" title={capa.actionPlan} number={capa.recordNumber} ownerIds={[capa.ownerId]} navigateTo="/capa" allowed={permitted} assignedOnly />
            <OpenFormButton formType="capa" entityId={capa.id} title={`${recordHeading("CAPA", capa.recordNumber)} Form`} />
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
      <SaveStatus saving={updateCapa.isPending} unsaved={narrativeDirty || (verificationTouched && textStillDirty(capa.verification ?? "", verification))} />
      <p className="text-sm text-muted-foreground">
        {capa.ncrId ? (
          <>
            Opened from <Link to={`/ncr/${capa.ncrId}`} className="text-primary hover:underline">{recordHeading("NCR", linkedNcr?.recordNumber)}</Link>.
          </>
        ) : (
          <>This CAPA isn't tied to an NCR yet. Link it from the NCR so containment, the CAPA, and the check stay one story.</>
        )}
      </p>

      <div className="aq-form-copy aq-print-stack grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="aq-print-sheet rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Cause</h2>
            {canEdit && <AiFieldAssistant
              module="capa"
              recordId={capaId}
              triggerLabel="AI Root Cause Analysis"
              buildInitialPrompt={() =>
                `Analyze the probable root cause for ${recordHeading("CAPA", capa.recordNumber)}${capa.ncrId ? " (linked to an NCR)" : ""}. ` +
                "Walk through a 5-Why analysis, note which Fishbone (Ishikawa) categories are most likely involved (e.g. method, machine," +
                " material, man, measurement, environment), and conclude with the single most probable root cause and a short list of" +
                " recommended corrective actions. This is a draft analysis for a quality engineer to review, not a final record."
              }
              onInsert={(text) => updateCapa.mutate({ id: capaId, rootCause: text })}
              insertLabel="Insert as Root Cause"
            />}
          </div>
          <StepNote editable={stepField("rootCause")} />
          <PictureBoundText
            saved={capa.rootCause ?? ""}
            readOnly={!stepField("rootCause")}
            placeholder={stepField("rootCause") ? "Type the cause" : "Not written yet."}
            entityType="capa"
            entityId={capaId}
            rows={4}
            commitRef={rootCommit}
            onPendingChange={noteNarrative("rootCause")}
            className={narrativeClass}
            onSave={(value) => stepField("rootCause") && updateCapa.mutate({ id: capaId, rootCause: value })}
          />
        </div>

        <div className="aq-print-sheet rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">What you'll do</h2>
          <StepNote editable={stepField("actionPlan")} />
          <PictureBoundText
            saved={capa.actionPlan ?? ""}
            readOnly={!stepField("actionPlan")}
            placeholder={stepField("actionPlan") ? "Type the fix" : undefined}
            entityType="capa"
            entityId={capaId}
            rows={4}
            commitRef={planCommit}
            onPendingChange={noteNarrative("actionPlan")}
            className={narrativeClass}
            onSave={(value) => stepField("actionPlan") && updateCapa.mutate({ id: capaId, actionPlan: value })}
          />
        </div>

        <div className="aq-print-sheet rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">How you'll keep it from coming back</h2>
          <StepNote editable={stepField("preventiveAction")} />
          <PictureBoundText
            saved={capa.preventiveAction ?? ""}
            readOnly={!stepField("preventiveAction")}
            placeholder={stepField("preventiveAction") ? "Type how you'll keep it from coming back" : undefined}
            entityType="capa"
            entityId={capaId}
            rows={4}
            commitRef={preventCommit}
            onPendingChange={noteNarrative("preventiveAction")}
            className={narrativeClass}
            onSave={(value) => stepField("preventiveAction") && updateCapa.mutate({ id: capaId, preventiveAction: value })}
          />
        </div>

        <div className="aq-print-sheet rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Did the fix work?</h2>
          {capa.status === "open" ? (
            <p className="text-sm text-muted-foreground">Start the work above first. You can't check the fix before that.</p>
          ) : (
            <>
              {!capa.verification && capa.status === "in_progress" && (
                <p className="mb-2 text-sm text-muted-foreground">Nothing recorded yet. Write what you checked, then submit it.</p>
              )}
              <StepNote editable={stepField("verification")} />
              <TextAreaField label="Did the fix work?" value={verification} onChange={(e) => { setVerificationTouched(true); setVerification(e.target.value); }} readOnly={!stepField("verification")} placeholder={stepField("verification") ? "Type what you checked" : undefined} />
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

        <div className="no-print rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">How solid is this writeup?</h2>
            {canEdit && <AiFieldAssistant
              module="capa_effectiveness"
              recordId={capaId}
              triggerLabel="AI Effectiveness Score"
              buildInitialPrompt={() =>
                `Score the effectiveness of ${recordHeading("CAPA", capa.recordNumber)} on a 0–100 scale. Base the score on how well-documented and complete the root` +
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

        <div className="no-print rounded-lg border border-border bg-card p-4">
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
                setVerificationTouched(true);
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

      <div className="no-print flex flex-col gap-4">
        <AttachmentsPanel entityType="capa" entityId={capaId} />
        <WorkflowHistoryPanel moduleName="capa" recordId={capaId} />
      </div>
    </div>
    </PictureRecordProvider>
  );
}

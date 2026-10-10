import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import type { Ncr, Capa } from "../../api/types";
import { RecordCrumbs } from "../../components/records/RecordStatus";
import { RecordNumberEditor } from "../../components/forms/RecordNumberField";
import { recordHeading, showRecordNumber } from "../../lib/userRecordNumber";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useModuleFormLock } from "../../hooks/useSavedFormMode";
import { ModuleFormLock } from "../../components/forms/SavedFormLockBar";
import { READ_ONLY_REASON } from "../../lib/opsLanguage";
import { SaveStatus } from "../../components/shared/SaveStatus";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { EightDWorkbook } from "./EightDSheets";
import { blank8dFromData, buildSaveData, previousFields, type Blank8DValues } from "../../lib/blank8d";
import { classifyStepSaveError, eightDNextLabel, eightDStepIsSaved, missingEightDFields, type StepSaveNotice } from "../../lib/eightDProgress";
import { readRequiredMap } from "../../components/forms/signatureRequired";
import { DEFAULT_CERTIFY, SignatureStamp } from "../../components/forms/SignatureStamp";
import { worksheetsFromReport, type WorksheetKey, type WorksheetValues } from "../../lib/eightDWorksheets";

interface EightDReport {
  id: number;
  ncrId: number | null;
  recordNumber?: string | null;
  currentStep: number;
  data: Record<string, unknown>;
  problemDescriptionD2?: Record<string, string>;
  problemSolvingWorksheetD4?: Record<string, string>;
  testingPossibleCausesD4?: Record<string, string>;
  decisionMaking?: Record<string, string>;
  riskAnalysis?: Record<string, string>;
  planProblemPrevention?: Record<string, string>;
}

interface EightDDraft {
  blank: Blank8DValues;
  sheets: WorksheetValues;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const source = item as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = source[key];
    return sorted;
  });
}

const STEPS = [
  { key: "d1_team", label: "D1" },
  { key: "d2_problem", label: "D2" },
  { key: "d3_containment", label: "D3" },
  { key: "d4_rootCause", label: "D4" },
  { key: "d5_correctiveAction", label: "D5" },
  { key: "d6_implementation", label: "D6" },
  { key: "d7_prevention", label: "D7" },
  { key: "d8_closure", label: "D8" },
] as const;

interface EightDSuggestion {
  d1_team: string;
  d2_problem: string;
  d3_containment: string;
  d4_rootCause: string;
  d5_correctiveAction: string;
  d6_implementation: string;
  d7_prevention: string;
  d8_closure: string;
}

function stepPayload(step: number, values: Blank8DValues): Record<string, unknown> {
  switch (step) {
    case 1:
      return { champion: values.champion, teamLeader: values.teamLeader, teamMembers: values.teamMembers };
    case 2:
      return { problemStatement: values.problemStatement };
    case 3:
      return {
        ica: values.ica,
        icaPercentEffective: values.icaPercentEffective,
        icaTargetDate: values.icaTargetDate,
        icaActualDate: values.icaActualDate,
      };
    case 4:
      return { rootCauses: values.rootCauses, rootCausePercentContribution: values.rootCausePercentContribution };
    case 5:
      return { pca: values.pca, pcaPercentEffective: values.pcaPercentEffective };
    case 6:
      return {
        implementation: values.implementation,
        implementationTargetDate: values.implementationTargetDate,
        implementationActualDate: values.implementationActualDate,
      };
    case 7:
      return {
        prevention: values.prevention,
        preventionTargetDate: values.preventionTargetDate,
        preventionActualDate: values.preventionActualDate,
        reviewedControlPlan: values.reviewedControlPlan,
        reviewedFmea: values.reviewedFmea,
        reviewedFlowchart: values.reviewedFlowchart,
        reviewedProcWorkInstr: values.reviewedProcWorkInstr,
        reviewedInternalAudit: values.reviewedInternalAudit,
      };
    default:
      return { recognition: values.recognition };
  }
}

const eightDHooks = createResourceHooks<EightDReport>("8d");
const ncrHooks = createResourceHooks<Ncr>("ncr");
const capaHooks = createResourceHooks<Capa>("capa");

export function EightDDetailPage() {
  const { id } = useParams();
  const reportId = Number(id);
  const permitted = useCanEditWorkflow("8d");
  const formLock = useModuleFormLock(reportId, permitted, `/8d/${reportId}/begin-edit`);
  const canEdit = formLock.fieldsEditable;
  const { data: report, isLoading, isError } = eightDHooks.useOne(reportId);
  const queryClient = useQueryClient();
  const completeStep = useMutation({
    mutationFn: async ({ step, data, pin }: { step: number; data: Record<string, unknown>; pin?: string }) =>
      (await apiClient.post(`/8d/${reportId}/complete-step/${step}`, { data, ...(pin ? { pin } : {}) })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["8d", reportId] }),
  });
  const [values, setValues] = useState<EightDDraft | null>(null);
  const [saveNotice, setSaveNotice] = useState<StepSaveNotice | null>(null);
  const [signStep, setSignStep] = useState<number | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const updateReport = eightDHooks.useUpdate();
  const { data: linkedNcr } = ncrHooks.useOne(report?.ncrId ?? undefined);
  const { data: linkedCapas = [] } = capaHooks.useList(report?.ncrId ? { ncrId: report.ncrId } : undefined, { enabled: report?.ncrId != null });
  const attachedCapaId = report && typeof report.data?.attachedCapaId === "number" ? report.data.attachedCapaId : report?.data?.attachedCapaId === null ? null : undefined;
  const linkedCapa = attachedCapaId === null ? undefined : attachedCapaId != null ? linkedCapas.find((capa) => capa.id === attachedCapaId) : linkedCapas[0];

  useEffect(() => {
    if (!report || loadedFor === report.id) return;
    setValues({ blank: blank8dFromData(report.data), sheets: worksheetsFromReport(report) });
    setLoadedFor(report.id);
  }, [loadedFor, report]);

  const baseline = report ? { blank: blank8dFromData(report.data), sheets: worksheetsFromReport(report) } : null;
  const draftDirty = !!values && !!baseline && stableJson(values) !== stableJson(baseline);

  function savePayload(draft: EightDDraft) {
    if (!report) return null;
    return {
      id: reportId,
      data: buildSaveData(report.data, draft.blank),
      problemDescriptionD2: draft.sheets.problemDescriptionD2,
      problemSolvingWorksheetD4: draft.sheets.problemSolvingWorksheetD4,
      testingPossibleCausesD4: draft.sheets.testingPossibleCausesD4,
      decisionMaking: draft.sheets.decisionMaking,
      riskAnalysis: draft.sheets.riskAnalysis,
      planProblemPrevention: draft.sheets.planProblemPrevention,
    };
  }

  const saveDraft = updateReport.mutate;
  useEffect(() => {
    if (!canEdit || !report || !values || !draftDirty) return;
    const payload = savePayload(values);
    if (!payload) return;
    const timer = setTimeout(() => {
      saveDraft(payload);
    }, 1200);
    return () => clearTimeout(timer);
  }, [canEdit, draftDirty, report, reportId, saveDraft, values]);

  function saveRecord() {
    if (!values) return;
    const payload = savePayload(values);
    if (payload) updateReport.mutate(payload);
  }

  if (isError) return <p className="text-sm text-destructive">Couldn't load this 8D report. Refresh the page and try again.</p>;
  if (isLoading || !report || !values) return <LoadingPlaceholder />;

  const loaded = report;
  const draft = values;
  const earlier = previousFields(loaded.data).filter((field) => !field.value.trim().startsWith("{") && !field.value.trim().startsWith("["));
  const nextLabel = eightDNextLabel(loaded.currentStep);
  const stepText = draft.blank as unknown as Record<string, string>;

  function saveStep(stepNumber: number) {
    setSaveNotice(null);
    const empty = missingEightDFields(stepNumber, stepText);
    if (empty.length > 0) {
      setSaveNotice({ kind: "validation", summary: `Missing: ${empty.join(", ")}`, fields: empty });
      return;
    }
    const needsSignature = Object.values(readRequiredMap(loaded.data)).includes("yes");
    if (needsSignature) {
      setSignStep(stepNumber);
      setSaveNotice({ kind: "signature", summary: "A signature PIN is required.", fields: [] });
      return;
    }
    void finishStep(stepNumber);
  }

  async function finishStep(stepNumber: number, pin?: string) {
    const payload = savePayload(draft);
    if (!payload) return;
    try {
      await updateReport.mutateAsync(payload);
      await completeStep.mutateAsync({ step: stepNumber, data: stepPayload(stepNumber, draft.blank), pin });
      setSaveNotice(null);
      setSignStep(null);
    } catch (err) {
      const notice = classifyStepSaveError(extractErrorMessage(err, "This step didn't save."), missingEightDFields(stepNumber, stepText));
      setSaveNotice(notice);
      if (notice.kind === "signature") setSignStep(stepNumber);
    }
  }

  return (
    <div className="eight-d-print flex flex-col gap-4">
      <div className="no-print flex flex-col gap-4">
        <RecordCrumbs
          items={[
            { label: "NCR", to: "/ncr" },
            ...(report.ncrId ? [{ label: "NCR", to: `/ncr/${report.ncrId}` }] : []),
            ...(linkedCapa ? [{ label: recordHeading("CAPA", linkedCapa.recordNumber), to: `/capa/${linkedCapa.id}` }] : []),
            { label: recordHeading("8D", report.recordNumber) },
          ]}
        />
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{recordHeading("8D report", report.recordNumber)}</h1>
            <RecordNumberEditor
              label="8D No."
              value={report.recordNumber}
              canEdit={canEdit}
              onSave={(next) => updateReport.mutateAsync({ id: reportId, recordNumber: next.trim() || null })}
            />
            <p className="text-sm text-muted-foreground">
              {nextLabel ? `Next: ${nextLabel}` : "Eight-step writeup"}
              {report.ncrId ? (
                <>
                  {" "}
                  · from <Link to={`/ncr/${report.ncrId}`} className="text-primary hover:underline">{recordHeading("NCR", linkedNcr?.recordNumber)}</Link>
                </>
              ) : null}
              {linkedCapa ? (
                <>
                  {" "}
                  · <Link to={`/capa/${linkedCapa.id}`} className="text-primary hover:underline">{recordHeading("CAPA", linkedCapa.recordNumber)}</Link>
                </>
              ) : report.ncrId ? (
                <> · no CAPA linked yet</>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ModuleFormLock mode={formLock.mode} canEdit={permitted} onEdit={() => formLock.onEdit()} onLock={formLock.lock} />
            <DeleteRecordButton resource="8d" id={reportId} kind="8D" title={values.blank.partNo || values.blank.problemStatement} number={report.recordNumber} navigateTo="/8d" allowed={permitted} assignedOnly />
            {linkedNcr && canEdit && (
              <AiStructuredSuggestion<EightDSuggestion>
                endpoint="/ai/8d"
                title="AI 8D Draft"
                triggerLabel="AI Draft 8D"
                acceptLabel="Fill In Draft"
                buildPayload={() => ({
                  ncrId: linkedNcr.id,
                  ncrData: { title: linkedNcr.title, description: linkedNcr.description, containment: linkedNcr.containment, rootCause: linkedNcr.rootCause },
                  capaData: linkedCapa
                    ? { rootCause: linkedCapa.rootCause, actionPlan: linkedCapa.actionPlan, preventiveAction: linkedCapa.preventiveAction }
                    : {},
                })}
                onAccept={(output) =>
                  setValues((current) =>
                    current
                      ? {
                          ...current,
                          blank: {
                            ...current.blank,
                            teamMembers: output.d1_team,
                            problemStatement: output.d2_problem,
                            ica: output.d3_containment,
                            rootCauses: output.d4_rootCause,
                            pca: output.d5_correctiveAction,
                            implementation: output.d6_implementation,
                            prevention: output.d7_prevention,
                            recognition: output.d8_closure,
                          },
                        }
                      : current
                  )
                }
                renderPreview={(output) => (
                  <div className="flex max-h-96 flex-col gap-3 overflow-y-auto text-sm">
                    {STEPS.map((step) => (
                      <div key={step.key}>
                        <p className="text-xs font-medium text-muted-foreground">{step.label}</p>
                        <p>{output[step.key]}</p>
                      </div>
                    ))}
                  </div>
                )}
              />
            )}
            <SaveStatus saving={updateReport.isPending} unsaved={draftDirty && !updateReport.isPending} />
            {canEdit && (
              <button
                type="button"
                onClick={saveRecord}
                disabled={updateReport.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
              >
                {updateReport.isPending ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>
        {!permitted && <p className="text-sm text-muted-foreground">{READ_ONLY_REASON}</p>}
        {!report.ncrId && (
          <p className="text-sm text-muted-foreground">This report isn't tied to an NCR. Link it from the NCR so the 8D, the CAPA, and the check stay one story.</p>
        )}
        {canEdit && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {STEPS.map((step, index) => {
                const stepNumber = index + 1;
                const isDone = eightDStepIsSaved(stepNumber, report.currentStep);
                return (
                  <button
                    key={step.key}
                    type="button"
                    onClick={() => saveStep(stepNumber)}
                    className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    {isDone ? `${step.label} saved` : `Save ${step.label}`}
                  </button>
                );
              })}
            </div>
            {saveNotice?.kind === "validation" && (
              <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm" data-testid="step-save-error">
                <p className="font-medium">This step didn't save.</p>
                <p>{saveNotice.summary}</p>
                {saveNotice.fields.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {saveNotice.fields.map((field) => (
                      <li key={field}>{field}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {signStep != null && (
              <div className="max-w-md rounded-md border border-border bg-card p-3" data-testid="step-signature">
                <p className="mb-2 text-sm font-medium">This step needs a signature.</p>
                <SignatureStamp
                  certify={DEFAULT_CERTIFY}
                  onSign={async (pin) => {
                    await finishStep(signStep, pin);
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="aq-form-copy aq-print-sheet min-w-0 rounded-lg border border-border bg-card p-4">
        <EightDWorkbook
          recordId={report.id}
          eightDNo={showRecordNumber(report.recordNumber)}
          blank={values.blank}
          sheets={values.sheets}
          readOnly={!canEdit}
          onBlankChange={(patch) => setValues((current) => (current ? { ...current, blank: { ...current.blank, ...patch } } : current))}
          onSheetChange={(key: WorksheetKey, address, value) =>
            setValues((current) =>
              current
                ? { ...current, sheets: { ...current.sheets, [key]: { ...current.sheets[key], [address]: value } } }
                : current
            )
          }
        />
      </div>

      {earlier.length > 0 && (
        <section className="no-print rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Previous fields</h2>
          <p className="mb-3 text-xs text-muted-foreground">Older 8D text that does not match a box on this form. It is kept on the report and cannot be edited here.</p>
          <dl className="flex flex-col gap-3">
            {earlier.map((field) => (
              <div key={`${field.label}-${field.value.slice(0, 24)}`}>
                <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
                <dd className="whitespace-pre-wrap text-sm">{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <div className="no-print flex flex-col gap-4">
        <AttachmentsPanel entityType="eight_d" entityId={report.id} />
        <WorkflowHistoryPanel moduleName="eight_d" recordId={report.id} />
      </div>
    </div>
  );
}

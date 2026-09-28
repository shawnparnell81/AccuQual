import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { PrintFormButton } from "../../components/forms/PrintFormButton";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import type { Ncr, Capa } from "../../api/types";
import { RecordCrumbs } from "../../components/records/RecordStatus";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { READ_ONLY_REASON } from "../../lib/opsLanguage";
import { SaveStatus } from "../../components/shared/SaveStatus";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { Blank8DSheet } from "./Blank8DSheet";
import { blank8dFromData, buildSaveData, previousFields, type Blank8DValues } from "../../lib/blank8d";

interface EightDReport {
  id: number;
  ncrId: number | null;
  currentStep: number;
  data: Record<string, unknown>;
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
  const canEdit = useCanEditWorkflow("8d");
  const { data: report, isLoading, isError } = eightDHooks.useOne(reportId);
  const queryClient = useQueryClient();
  const completeStep = useMutation({
    mutationFn: async ({ step, data }: { step: number; data: Record<string, unknown> }) =>
      (await apiClient.post(`/8d/${reportId}/complete-step/${step}`, { data })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["8d", reportId] }),
  });
  const [values, setValues] = useState<Blank8DValues | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const updateReport = eightDHooks.useUpdate();
  const { data: linkedNcr } = ncrHooks.useOne(report?.ncrId ?? undefined);
  const { data: linkedCapas = [] } = capaHooks.useList(report?.ncrId ? { ncrId: report.ncrId } : undefined, { enabled: report?.ncrId != null });
  const linkedCapa = linkedCapas[0];

  useEffect(() => {
    if (!report || loadedFor === report.id) return;
    setValues(blank8dFromData(report.data));
    setLoadedFor(report.id);
  }, [loadedFor, report]);

  const baseline = report ? blank8dFromData(report.data) : null;
  const draftDirty = !!values && !!baseline && JSON.stringify(values) !== JSON.stringify(baseline);

  const saveDraft = updateReport.mutate;
  useEffect(() => {
    if (!canEdit || !report || !values || !draftDirty) return;
    const timer = setTimeout(() => {
      saveDraft({ id: reportId, data: buildSaveData(report.data, values) });
    }, 1200);
    return () => clearTimeout(timer);
  }, [canEdit, draftDirty, report, reportId, saveDraft, values]);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this 8D report. Refresh the page and try again.</p>;
  if (isLoading || !report || !values) return <LoadingPlaceholder />;

  const earlier = previousFields(report.data);
  const nextStep = STEPS[report.currentStep - 1];

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-4">
        <RecordCrumbs
          items={[
            { label: "NCR", to: "/ncr" },
            ...(report.ncrId ? [{ label: `NCR #${report.ncrId}`, to: `/ncr/${report.ncrId}` }] : []),
            ...(linkedCapa ? [{ label: `CAPA #${linkedCapa.id}`, to: `/capa/${linkedCapa.id}` }] : []),
            { label: `8D #${report.id}` },
          ]}
        />
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">8D report #{report.id}</h1>
            <p className="text-sm text-muted-foreground">
              {nextStep ? `Next: ${nextStep.label}` : "Eight-step writeup"}
              {report.ncrId ? (
                <>
                  {" "}
                  · from <Link to={`/ncr/${report.ncrId}`} className="text-primary hover:underline">NCR #{report.ncrId}</Link>
                </>
              ) : null}
              {linkedCapa ? (
                <>
                  {" "}
                  · <Link to={`/capa/${linkedCapa.id}`} className="text-primary hover:underline">CAPA #{linkedCapa.id}</Link>
                </>
              ) : report.ncrId ? (
                <> · no CAPA linked yet</>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
                          teamMembers: output.d1_team,
                          problemStatement: output.d2_problem,
                          ica: output.d3_containment,
                          rootCauses: output.d4_rootCause,
                          pca: output.d5_correctiveAction,
                          implementation: output.d6_implementation,
                          prevention: output.d7_prevention,
                          recognition: output.d8_closure,
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
            <PrintFormButton formType="eight_d" entityId={report.id} />
          </div>
        </div>
        {!canEdit && <p className="text-sm text-muted-foreground">{READ_ONLY_REASON}</p>}
        {!report.ncrId && (
          <p className="text-sm text-muted-foreground">This report isn't tied to an NCR. Link it from the NCR so the 8D, the CAPA, and the check stay one story.</p>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {STEPS.map((step, index) => {
              const stepNumber = index + 1;
              const isDone = stepNumber < report.currentStep;
              return (
                <button
                  key={step.key}
                  onClick={() =>
                    updateReport.mutate(
                      { id: reportId, data: buildSaveData(report.data, values) },
                      { onSuccess: () => completeStep.mutate({ step: stepNumber, data: stepPayload(stepNumber, values) }) }
                    )
                  }
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  {isDone ? `${step.label} saved` : `Save ${step.label}`}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Blank8DSheet
        eightDNo={report.id}
        values={values}
        readOnly={!canEdit}
        onChange={(patch) => setValues((current) => (current ? { ...current, ...patch } : current))}
      />

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

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { TextAreaField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { PrintFormButton } from "../../components/forms/PrintFormButton";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";
import type { Ncr, Capa } from "../../api/types";
import { RecordCrumbs } from "../../components/records/RecordStatus";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { READ_ONLY_REASON } from "../../lib/opsLanguage";

interface EightDReport {
  id: number;
  ncrId: number | null;
  currentStep: number;
  data: Record<string, string>;
}

const STEPS = [
  { key: "d1_team", label: "D1 — Establish the Team" },
  { key: "d2_problem", label: "D2 — Describe the Problem" },
  { key: "d3_containment", label: "D3 — Interim Containment Action" },
  { key: "d4_rootCause", label: "D4 — Root Cause Analysis" },
  { key: "d5_correctiveAction", label: "D5 — Permanent Corrective Action" },
  { key: "d6_implementation", label: "D6 — Implement & Validate" },
  { key: "d7_prevention", label: "D7 — Prevent Recurrence" },
  { key: "d8_closure", label: "D8 — Congratulate the Team / Closure" },
] as const;

/** Exact shape of runEightDGeneratorPipeline's output (ai.guardrails.ts's eightDOutputSchema) — keys deliberately match STEPS above 1:1. */
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
    mutationFn: async ({ step, data }: { step: number; data: unknown }) =>
      (await apiClient.post(`/8d/${reportId}/complete-step/${step}`, { data })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["8d", reportId] }),
  });
  const [draftByStep, setDraftByStep] = useState<Record<string, string>>({});
  const { data: linkedNcr } = ncrHooks.useOne(report?.ncrId ?? undefined);
  // Same client-filtered pattern the NCR workspace's own Linked Records
  // panel already uses (GET /capa has no ?ncrId= filter) — fine at this
  // data scale, matching that page's own reasoning.
  const { data: allCapas = [] } = capaHooks.useList();
  const linkedCapa = allCapas.find((c) => c.ncrId === report?.ncrId);

  if (isError) return <p className="text-sm text-destructive">Couldn't load this 8D report. Refresh the page and try again.</p>;
  if (isLoading || !report) return <p className="text-sm text-muted-foreground">Loading this 8D report…</p>;

  const step = STEPS[report.currentStep - 1];

  return (
    <div className="flex flex-col gap-4">
      <RecordCrumbs
        items={[
          { label: "Issues", to: "/ncr" },
          ...(report.ncrId ? [{ label: `Issue #${report.ncrId}`, to: `/ncr/${report.ncrId}` }] : []),
          ...(linkedCapa ? [{ label: `Fix #${linkedCapa.id}`, to: `/capa/${linkedCapa.id}` }] : []),
          { label: `8D #${report.id}` },
        ]}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">8D report #{report.id}</h1>
          <p className="text-sm text-muted-foreground">
            {step ? `Next: ${step.label.replace(/—/, "·")}` : "Eight-step writeup"}
            {report.ncrId ? (
              <>
                {" "}
                · from <Link to={`/ncr/${report.ncrId}`} className="text-primary hover:underline">issue #{report.ncrId}</Link>
              </>
            ) : null}
            {linkedCapa ? (
              <>
                {" "}
                · <Link to={`/capa/${linkedCapa.id}`} className="text-primary hover:underline">fix #{linkedCapa.id}</Link>
              </>
            ) : report.ncrId ? (
              <> · no fix linked yet</>
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
              onAccept={(output) => setDraftByStep({ ...output })}
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
          <OpenFormButton formType="eight_d" entityId={report.id} title={`8D Report #${report.id} Form`} />
          <PrintFormButton formType="eight_d" entityId={report.id} />
        </div>
      </div>
      {!canEdit && <p className="text-sm text-muted-foreground">{READ_ONLY_REASON}</p>}
      {!report.ncrId && (
        <p className="text-sm text-muted-foreground">This report isn't tied to an issue. Link it from the issue so the 8D, the fix, and the check stay one story.</p>
      )}

      <div className="flex flex-col gap-3">
        {STEPS.map((step, index) => {
          const stepNumber = index + 1;
          const isCurrent = stepNumber === report.currentStep;
          const isDone = stepNumber < report.currentStep;

          return (
            <div key={step.key} className={`rounded-lg border p-4 ${isCurrent ? "border-primary" : "border-border"} bg-card`}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium">{step.label}</h2>
                {isDone && <span className="text-xs text-emerald-600">Complete</span>}
              </div>
              <TextAreaField
                label=""
                readOnly={!canEdit}
                value={draftByStep[step.key] ?? report.data?.[step.key] ?? ""}
                onChange={(e) => setDraftByStep((d) => ({ ...d, [step.key]: e.target.value }))}
              />
              {canEdit && (
              <button
                onClick={() =>
                  completeStep.mutate({
                    step: stepNumber,
                    data: draftByStep[step.key] ?? report.data?.[step.key] ?? "",
                  })
                }
                className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Save step
              </button>
              )}
            </div>
          );
        })}
      </div>

      <AttachmentsPanel entityType="eight_d" entityId={report.id} />
    </div>
  );
}

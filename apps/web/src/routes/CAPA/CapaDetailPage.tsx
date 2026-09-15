import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import type { Capa } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextAreaField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { useWorkflowAction, useWorkflowUpdate } from "../../hooks/useWorkflowAction";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";

const capaHooks = createResourceHooks<Capa>("capa");

/** CAPA Detail: root cause summary, action plan, verification steps, AI-generated recommendations, history. */
export function CapaDetailPage() {
  const { id } = useParams();
  const capaId = Number(id);
  const historyKey: unknown[][] = [["workflow-history", "capa", capaId]];
  const { data: capa, isLoading } = capaHooks.useOne(capaId);
  useSetAssistantContext("capa", capaId, `CAPA #${capaId}`);
  const updateCapa = capaHooks.useUpdate();
  // Open -> In Progress is generic-PATCH-only on the backend (no dedicated
  // endpoint — see the Transitions/Rules Dictionaries), so this is the one
  // action here that goes through useWorkflowUpdate, not useWorkflowAction.
  const startAction = useWorkflowUpdate<{ id: number; status: string }>("capa", { successMessage: "CAPA started.", invalidateKeys: historyKey });
  const verifyAction = useWorkflowAction("capa", "verify", { successMessage: "Verification recorded.", invalidateKeys: historyKey });
  const closeAction = useWorkflowAction("capa", "close", { successMessage: "CAPA closed.", invalidateKeys: historyKey });
  const [verification, setVerification] = useState("");

  const aiSuggestion = useQuery({
    queryKey: ["ai-capa", capaId],
    queryFn: async () =>
      (await apiClient.post("/ai/capa", { ncrId: capa?.ncrId, rootCause: capa?.rootCause, ncrData: capa })).data,
    enabled: false,
  });

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
          <WorkflowActionButton
            label="Start Work"
            navKey="capa"
            action={startAction}
            onClick={() => startAction.mutate({ id: capaId, status: "in_progress" })}
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
          <h2 className="mb-2 text-sm font-medium">Verification Steps</h2>
          {capa.status === "open" ? (
            <p className="text-sm text-muted-foreground">Start work above first — verification can't be recorded before that.</p>
          ) : (
            <>
              <TextAreaField label="" value={verification} onChange={(e) => setVerification(e.target.value)} />
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
          <h2 className="mb-2 text-sm font-medium">AI-Generated CAPA Recommendations</h2>
          <button
            onClick={() => aiSuggestion.refetch()}
            disabled={aiSuggestion.isFetching}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
          >
            {aiSuggestion.isFetching ? "Generating…" : "Generate recommendations"}
          </button>
          {aiSuggestion.data && (
            <pre className="mt-3 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(aiSuggestion.data.output, null, 2)}
            </pre>
          )}
        </div>
      </div>

      <AttachmentsPanel entityType="capa" entityId={capaId} />
      <WorkflowHistoryPanel moduleName="capa" recordId={capaId} />
    </div>
  );
}

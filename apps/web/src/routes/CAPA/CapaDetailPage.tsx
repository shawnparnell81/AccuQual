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
import { useSetAssistantContext } from "../../hooks/useAssistantContext";

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
          <h2 className="mb-2 text-sm font-medium">Root Cause Summary</h2>
          <p className="text-sm text-muted-foreground">{capa.rootCause || "Not yet documented."}</p>
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

      <WorkflowHistoryPanel moduleName="capa" recordId={capaId} />
    </div>
  );
}

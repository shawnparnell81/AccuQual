import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import type { Capa } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextAreaField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";

const capaHooks = createResourceHooks<Capa>("capa");

/** CAPA Detail: root cause summary, action plan, verification steps, AI-generated recommendations. */
export function CapaDetailPage() {
  const { id } = useParams();
  const capaId = Number(id);
  const { data: capa, isLoading } = capaHooks.useOne(capaId);
  const updateCapa = capaHooks.useUpdate();
  const verifyAction = capaHooks.useAction("verify");
  const closeAction = capaHooks.useAction("close");
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
          {capa.status !== "closed" && (
            <button onClick={() => closeAction.mutate({ id: capaId })} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Close CAPA
            </button>
          )}
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
          <TextAreaField label="" value={verification} onChange={(e) => setVerification(e.target.value)} />
          <button
            onClick={() => verifyAction.mutate({ id: capaId, verification })}
            className="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          >
            Submit verification
          </button>
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
    </div>
  );
}

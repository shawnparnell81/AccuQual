import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import type { Ncr, Capa } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextAreaField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { useWorkflowAction } from "../../hooks/useWorkflowAction";
import { WorkflowActionButton } from "../../components/shared/WorkflowActionButton";
import { WorkflowHistoryPanel } from "../../components/shared/WorkflowHistoryPanel";

const ncrHooks = createResourceHooks<Ncr>("ncr");
const capaHooks = createResourceHooks<Capa>("capa");

const TABS = ["Overview", "Root Cause", "CAPA", "8D", "AI Suggestions", "History"] as const;
type Tab = (typeof TABS)[number];

export function NcrDetailPage() {
  const { id } = useParams();
  const ncrId = Number(id);
  const [tab, setTab] = useState<Tab>("Overview");
  const historyKey: unknown[][] = [["workflow-history", "ncr", ncrId]];

  const { data: ncr, isLoading } = ncrHooks.useOne(ncrId);
  const containmentAction = useWorkflowAction("ncr", "containment", { successMessage: "Containment recorded.", invalidateKeys: historyKey });
  const rootCauseAction = useWorkflowAction("ncr", "root-cause", { successMessage: "Root cause recorded.", invalidateKeys: historyKey });
  const correctiveActionAction = useWorkflowAction("ncr", "corrective-action", { successMessage: "Corrective action recorded.", invalidateKeys: historyKey });
  const closeAction = useWorkflowAction("ncr", "close", { successMessage: "NCR closed.", invalidateKeys: historyKey });

  if (isLoading || !ncr) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            NCR #{ncr.id} — {ncr.title}
          </h1>
          <div className="mt-1 flex gap-2">
            <StatusBadge value={ncr.severity} />
            <StatusBadge value={ncr.status} />
          </div>
        </div>
        <div className="flex gap-2">
          <OpenFormButton formType="ncr" entityId={ncr.id} title={`NCR #${ncr.id} Form`} />
          <WorkflowActionButton
            label="Close NCR"
            navKey="ncr"
            action={closeAction}
            onClick={() => closeAction.mutate({ id: ncrId })}
            visible={ncr.status === "corrective_action"}
          />
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm ${tab === t ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
          <p className="text-sm">{ncr.description || "No description provided."}</p>
          <ActionForm
            label="Containment"
            value={ncr.containment}
            onSubmit={(value) => containmentAction.mutate({ id: ncrId, containment: value })}
          />
        </div>
      )}

      {tab === "Root Cause" && (
        <div className="rounded-lg border border-border bg-card p-4">
          {ncr.status === "open" ? (
            <p className="text-sm text-muted-foreground">Record containment on the Overview tab first — root cause can't be recorded before that.</p>
          ) : (
            <ActionForm
              label="Root cause"
              value={ncr.rootCause}
              onSubmit={(value) => rootCauseAction.mutate({ id: ncrId, rootCause: value })}
            />
          )}
          {ncr.status !== "open" && ncr.status !== "contained" && (
            <div className="mt-4">
              <ActionForm
                label="Corrective action"
                value={ncr.correctiveAction}
                onSubmit={(value) => correctiveActionAction.mutate({ id: ncrId, correctiveAction: value })}
              />
            </div>
          )}
        </div>
      )}

      {tab === "CAPA" && <CapaTab ncrId={ncrId} />}
      {tab === "8D" && <EightDTab ncrId={ncrId} />}
      {tab === "AI Suggestions" && <AiSuggestionsTab ncr={ncr} />}
      {tab === "History" && <WorkflowHistoryPanel moduleName="ncr" recordId={ncrId} />}
    </div>
  );
}

function ActionForm({ label, value, onSubmit }: { label: string; value: string | null; onSubmit: (value: string) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <TextAreaField label={label} value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button type="submit" className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
        Save
      </button>
    </form>
  );
}

function CapaTab({ ncrId }: { ncrId: number }) {
  const { data: capas = [] } = capaHooks.useList();
  const createCapa = capaHooks.useCreate();
  const navigate = useNavigate();
  const linked = capas.filter((c) => c.ncrId === ncrId);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Linked CAPAs</h3>
        <button
          onClick={() => createCapa.mutate({ ncrId }, { onSuccess: (created) => navigate(`/capa/${created.id}`) })}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          + Create CAPA from this NCR
        </button>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {linked.length === 0 && <li className="text-muted-foreground">No CAPA linked yet.</li>}
        {linked.map((c) => (
          <li key={c.id} className="border-b border-border pb-1">
            <button onClick={() => navigate(`/capa/${c.id}`)} className="flex w-full items-center justify-between text-left hover:text-primary">
              <span>CAPA #{c.id}</span>
              <StatusBadge value={c.status} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EightDTab({ ncrId }: { ncrId: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      Draft an 8D report for NCR #{ncrId} from the{" "}
      <a href="/8d" className="text-primary">
        8D Reports
      </a>{" "}
      module, or generate a first draft via AI Suggestions.
    </div>
  );
}

function AiSuggestionsTab({ ncr }: { ncr: Ncr }) {
  const { data, refetch, isFetching } = useQuery({
    queryKey: ["ai-root-cause", ncr.id],
    queryFn: async () => (await apiClient.post("/ai/root-cause", { ncrId: ncr.id, ncrData: ncr })).data,
    enabled: false,
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <button
        onClick={() => refetch()}
        disabled={isFetching}
        className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
      >
        {isFetching ? "Analyzing…" : "Suggest root cause with AI"}
      </button>
      {data && (
        <pre className="mt-3 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{JSON.stringify(data.output, null, 2)}</pre>
      )}
    </div>
  );
}


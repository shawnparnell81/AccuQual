import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { TextAreaField, SelectField } from "../../components/forms/Field";

/**
 * AI Insights: predicted high-risk NCRs, suggested CAPA improvements, process
 * drift alerts, supplier risk predictions — backed by /ai/analysis + /ai/risk-score.
 * Each pipeline call below returns and displays its own result card; AccuQual
 * doesn't yet expose a dedicated "list all past ai_suggestions" endpoint.
 */
export function AiInsightsPage() {
  const [kind, setKind] = useState<"audit_prep" | "document_summary" | "predictive_quality">("predictive_quality");
  const [input, setInput] = useState("{}");

  const analysis = useMutation({
    mutationFn: async () => (await apiClient.post("/ai/analysis", { kind, input: JSON.parse(input) })).data,
  });

  const riskScore = useMutation({
    mutationFn: async (entityType: string) =>
      (await apiClient.post("/ai/risk-score", { entityType, input: JSON.parse(input) })).data,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-4">
        <h1 className="mb-3 text-lg font-semibold">AI Insights</h1>
        <SelectField label="Pipeline" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="predictive_quality">Predictive Quality (defect trends & drift risk)</option>
          <option value="audit_prep">Audit Prep Assistant</option>
          <option value="document_summary">Document Summarization</option>
        </SelectField>
        <div className="mt-3">
          <TextAreaField label="Input (JSON)" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={() => analysis.mutate()} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            Run pipeline
          </button>
          <button
            onClick={() => riskScore.mutate("supplier")}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Score supplier risk
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          A one-off 0-100 AI opinion here — not the same thing as the <a href="/risk" className="text-primary hover:underline">Risk Register</a> (a tracked
          record with a workflow and mitigation plan) or the Digital Twin's simulation heatmap.
        </p>

        {analysis.data && (
          <pre className="mt-4 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{JSON.stringify(analysis.data.output, null, 2)}</pre>
        )}
        {riskScore.data && (
          <pre className="mt-4 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{JSON.stringify(riskScore.data, null, 2)}</pre>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">How this feeds every module</h2>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>NCR detail → AI Suggestions tab calls /ai/root-cause</li>
          <li>CAPA detail → AI recommendations call /ai/capa</li>
          <li>8D drafting can call /ai/8d for a first D1-D8 draft</li>
          <li>Supplier risk & process drift use this page's pipelines</li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Run a pipeline above to see results.</p>
      </div>
    </div>
  );
}

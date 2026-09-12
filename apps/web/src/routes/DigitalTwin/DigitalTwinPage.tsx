import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import type { DigitalTwinModel } from "../../api/types";
import { TextField } from "../../components/forms/Field";

const twinHooks = createResourceHooks<DigitalTwinModel>("digital-twin/models");

interface SimulationResult {
  predictedDefectRatePct: number;
  bottleneck: { nodeId: string; utilizationPct: number } | null;
  riskHeatmap: Array<{ nodeId: string; riskScore: number }>;
  recommendedActions: string[];
}

/**
 * Digital Twin: process flow diagram, machine nodes, risk heatmap,
 * simulation controls, time slider for historical playback (IoT stream).
 */
export function DigitalTwinPage() {
  const { data: models = [] } = twinHooks.useList();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [demandPerHour, setDemandPerHour] = useState(100);

  const simulate = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<{ results: SimulationResult }>("/digital-twin/simulate", {
          modelId: selectedId,
          parameters: { demandPerHour },
        })
      ).data,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <div className="rounded-lg border border-border bg-card p-4">
        <h1 className="mb-3 text-lg font-semibold">Digital Twin Models</h1>
        <ul className="flex flex-col gap-2 text-sm">
          {models.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => setSelectedId(m.id)}
                className={`w-full rounded-md border px-3 py-2 text-left ${
                  selectedId === m.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                }`}
              >
                {m.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {(m.modelJson?.nodes ?? []).length} nodes
                </span>
              </button>
            </li>
          ))}
          {models.length === 0 && <li className="text-muted-foreground">No models yet — create one via the API/DB seed.</li>}
        </ul>

        <div className="mt-4 flex flex-col gap-2">
          <TextField
            label="Demand per hour"
            type="number"
            value={demandPerHour}
            onChange={(e) => setDemandPerHour(Number(e.target.value))}
          />
          <button
            onClick={() => simulate.mutate()}
            disabled={!selectedId || simulate.isPending}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {simulate.isPending ? "Simulating…" : "Run simulation"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Simulation Results</h2>
          {!simulate.data && <p className="text-sm text-muted-foreground">Select a model and run a simulation.</p>}
          {simulate.data && (
            <div className="flex flex-col gap-3 text-sm">
              <p>
                Predicted defect rate: <strong>{simulate.data.results.predictedDefectRatePct}%</strong>
              </p>
              {simulate.data.results.bottleneck && (
                <p>
                  Bottleneck: <strong>{simulate.data.results.bottleneck.nodeId}</strong> at{" "}
                  {simulate.data.results.bottleneck.utilizationPct}% utilization
                </p>
              )}

              <div>
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">Risk Heatmap</h3>
                <div className="flex flex-wrap gap-2">
                  {simulate.data.results.riskHeatmap.map((node) => (
                    <span
                      key={node.nodeId}
                      className="rounded-md px-3 py-1 text-xs text-white"
                      style={{ backgroundColor: heatColor(node.riskScore) }}
                    >
                      {node.nodeId}: {node.riskScore}%
                    </span>
                  ))}
                </div>
              </div>

              {simulate.data.results.recommendedActions.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">Recommended Actions</h3>
                  <ul className="list-disc pl-5">
                    {simulate.data.results.recommendedActions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function heatColor(riskScore: number): string {
  if (riskScore > 10) return "#e11d48";
  if (riskScore > 5) return "#fb923c";
  if (riskScore > 1) return "#f59e0b";
  return "#64748b";
}

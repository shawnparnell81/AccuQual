import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import type { DigitalTwinModel, IotDriftAlert } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextField } from "../../components/forms/Field";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";
import { DigitalTwinDiagram, heatColor } from "./DigitalTwinDiagram";

const twinHooks = createResourceHooks<DigitalTwinModel>("digital-twin/models");

interface SimulationResult {
  predictedDefectRatePct: number;
  bottleneck: { nodeId: string; utilizationPct: number } | null;
  riskHeatmap: Array<{ nodeId: string; riskScore: number }>;
  recommendedActions: string[];
}

/** The real POST /digital-twin/simulate response is the saved digital_twin_simulations row — id included — not just its `results` column. */
interface SimulationRun {
  id: number;
  results: SimulationResult;
}

/**
 * Recent drift alerts from the digital-twin worker — real IoT readings (sent
 * with a device key or a user token) that jumped to over 3x, or fell under a
 * third of, a channel's running baseline. Refreshes on its own so an alert
 * shows up without reloading the page.
 */
function DriftAlertsPanel() {
  const { data: alerts = [], isLoading } = useQuery<IotDriftAlert[]>({
    queryKey: ["digital-twin/alerts"],
    queryFn: async () => (await apiClient.get("/digital-twin/alerts", { params: { limit: 25 } })).data,
    refetchInterval: 30_000,
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-medium">Live Drift Alerts</h2>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No drift detected. Alerts appear here when a device's readings jump well above or below their normal level.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-2">When</th>
              <th className="pb-2">Device</th>
              <th className="pb-2">Channel</th>
              <th className="pb-2">Reading</th>
              <th className="pb-2">Normal</th>
              <th className="pb-2">Severity</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="py-1.5 text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</td>
                <td className="py-1.5">
                  {a.deviceName ?? a.deviceId ?? "—"}
                  {a.deviceName && a.deviceId && <span className="ml-1 text-xs text-muted-foreground">({a.deviceId})</span>}
                </td>
                <td className="py-1.5">{a.channel ?? "—"}</td>
                <td className="py-1.5 tabular-nums">
                  {a.reading ?? "—"} <span className="text-xs text-muted-foreground">{a.direction === "up" ? "▲ high" : a.direction === "down" ? "▼ low" : ""}</span>
                </td>
                <td className="py-1.5 tabular-nums text-muted-foreground">{a.baseline === null ? "—" : Number(a.baseline.toFixed(2))}</td>
                <td className="py-1.5">
                  <StatusBadge value={a.score !== null && a.score >= 85 ? "critical" : a.score !== null && a.score >= 65 ? "high" : "medium"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Digital Twin: process flow diagram, machine nodes, simulation controls,
 * a per-node risk heatmap from the simulation, and live IoT drift alerts.
 */
export function DigitalTwinPage() {
  const { data: models = [] } = twinHooks.useList();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [demandPerHour, setDemandPerHour] = useState(100);
  const [iterations, setIterations] = useState(1000);
  const [driftFactor, setDriftFactor] = useState(1);
  const selectedModel = models.find((m) => m.id === selectedId);

  const simulate = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<SimulationRun>("/digital-twin/simulate", {
          modelId: selectedId,
          parameters: { demandPerHour, iterations, driftFactor },
        })
      ).data,
  });

  // Only a saved simulation run has a real id the backend context loader
  // can look up (see ai.assistant.ts's "digital_twin" case, keyed on
  // digital_twin_simulations.id) — recordId stays undefined until one
  // exists rather than pointing at a model id.
  useSetAssistantContext("digital_twin", simulate.data?.id, selectedModel ? `Digital Twin — ${selectedModel.name}` : "Digital Twin");

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
          {models.length === 0 && <li className="text-muted-foreground">No models yet — an admin can create one under Admin → Digital Twin Setup.</li>}
        </ul>

        <div className="mt-4 flex flex-col gap-2">
          <TextField
            label="Demand per hour"
            type="number"
            value={demandPerHour}
            onChange={(e) => setDemandPerHour(Number(e.target.value))}
          />
          <TextField
            label="Simulated units"
            type="number"
            min={100}
            max={100000}
            step={100}
            value={iterations}
            onChange={(e) => setIterations(Math.max(100, Math.min(100000, Number(e.target.value) || 1000)))}
          />
          <TextField
            label="Process drift factor (1 = normal)"
            type="number"
            min={0.1}
            step={0.1}
            value={driftFactor}
            onChange={(e) => setDriftFactor(Math.max(0.1, Number(e.target.value) || 1))}
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
        {selectedModel && (
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-medium">Process Graph</h2>
            <DigitalTwinDiagram
              nodes={selectedModel.modelJson?.nodes ?? []}
              edges={selectedModel.modelJson?.edges ?? []}
              riskHeatmap={simulate.data?.results.riskHeatmap}
              bottleneck={simulate.data?.results.bottleneck}
            />
          </div>
        )}

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Simulation Results</h2>
            {simulate.data && (
              <AiFieldAssistant
                module="digital_twin"
                recordId={simulate.data.id}
                triggerLabel="Interpret Simulation"
                buildInitialPrompt={() =>
                  "Interpret this digital twin simulation's results: summarize what they mean in plain language, highlight any anomalies" +
                  " or concerning values, explain what the bottleneck and risk heatmap indicate about the process, and suggest reasonable" +
                  " next steps to investigate or address them."
                }
              />
            )}
          </div>
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
                <h3 className="mb-1 text-xs font-medium text-muted-foreground" title="Scores this simulation's model nodes, not real-world records — see the Risk Register (/risk) for tracked risks with a workflow.">
                  Risk Heatmap (this simulation)
                </h3>
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

        <DriftAlertsPanel />
      </div>
    </div>
  );
}

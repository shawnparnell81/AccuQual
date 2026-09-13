import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { TextField, SelectField } from "../../components/forms/Field";
import type { TenantAiConfig } from "../../api/types";

// The two real, already-integrated providers (see llm-gateway.ts) — not an
// open list, so this can never store a provider the app has no code path for.
const PROVIDERS = ["anthropic", "openai"] as const;

function useAiConfig() {
  return useQuery<TenantAiConfig>({ queryKey: ["tenant/ai-config"], queryFn: async () => (await apiClient.get("/tenant/ai-config")).data });
}

function AiConfigForm() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useAiConfig();
  const [provider, setProvider] = useState<string>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [temperature, setTemperature] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [assistantName, setAssistantName] = useState("");

  useEffect(() => {
    if (config) {
      setProvider(config.provider ?? "anthropic");
      setModelName(config.modelName ?? "");
      setTemperature(config.temperature?.toString() ?? "");
      setMaxTokens(config.maxTokens?.toString() ?? "");
      setAssistantName(config.assistantName ?? "");
    }
  }, [config]);

  const save = useMutation({
    mutationFn: async () =>
      (
        await apiClient.patch("/tenant/ai-config", {
          provider,
          apiKey: apiKey || undefined, // blank = leave the stored key untouched
          modelName: modelName || undefined,
          temperature: temperature ? Number(temperature) : undefined,
          maxTokens: maxTokens ? Number(maxTokens) : undefined,
          assistantName, // "" clears it back to the default label — see updateAiConfigHandler
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant/ai-config"] });
      queryClient.invalidateQueries({ queryKey: ["tenant/assistant-name"] });
      setApiKey("");
      toast.success("AI configuration saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save AI configuration.")),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        This provider and key are used by the AI Assistant (the chat panel available to every user) and by AccuQual's other AI
        features, whenever a key is set here — falling back to the platform's own configured provider otherwise.
      </p>

      <TextField
        label="Assistant Name"
        value={assistantName}
        onChange={(e) => setAssistantName(e.target.value)}
        placeholder="AcuAI"
        maxLength={80}
      />

      <SelectField label="Provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </SelectField>

      <TextField
        label={config?.hasApiKey ? `API Key (currently ${config.maskedApiKey}) — leave blank to keep it` : "API Key"}
        type="password"
        placeholder={config?.hasApiKey ? "Leave blank to keep the current key" : "sk-…"}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <TextField label="Model Name" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="claude-sonnet-5" />
      <TextField label="Temperature (0–2)" type="number" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
      <TextField label="Max Tokens" type="number" min="1" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />

      <button type="submit" disabled={save.isPending} className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {save.isPending ? "Saving…" : "Save AI Configuration"}
      </button>
    </form>
  );
}

export function AdminTenantAiConfigPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tenant AI Configuration</h1>
      <AdminOnlyGuard>
        <AiConfigForm />
      </AdminOnlyGuard>
    </div>
  );
}

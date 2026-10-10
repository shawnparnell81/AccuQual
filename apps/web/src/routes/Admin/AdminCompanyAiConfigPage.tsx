import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";
import { TextField, SelectField } from "../../components/forms/Field";
import type { CompanyAiConfig } from "../../api/types";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { aiProviderStatus } from "../../lib/aiFeatures";

// The two real, already-integrated providers (see llm-gateway.ts) — not an
// open list, so this can never store a provider the app has no code path for.
const PROVIDERS = ["anthropic", "openai"] as const;

function useAiConfig() {
  return useQuery<CompanyAiConfig>({ queryKey: ["company/ai-config"], queryFn: async () => (await apiClient.get("/company/ai-config")).data });
}

function AiProviderStatus({ source, featuresEnabled }: { source: CompanyAiConfig["keySource"]; featuresEnabled: boolean }) {
  const status = aiProviderStatus(source ?? "none", featuresEnabled);
  return (
    <div data-testid="ai-provider-key-status" className="flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
      <p>{status.live}</p>
      <p>{status.key}</p>
    </div>
  );
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
  const [safetyMode, setSafetyMode] = useState<"standard" | "strict">("standard");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [limitEnforced, setLimitEnforced] = useState(false);
  const [featuresEnabled, setFeaturesEnabled] = useState(true);

  useEffect(() => {
    if (config) {
      setProvider(config.provider ?? "anthropic");
      setModelName(config.modelName ?? "");
      setTemperature(config.temperature?.toString() ?? "");
      setMaxTokens(config.maxTokens?.toString() ?? "");
      setAssistantName(config.assistantName ?? "");
      setSafetyMode(config.safetyMode ?? "standard");
      setMonthlyLimit(config.monthlyLimit?.toString() ?? "");
      setLimitEnforced(config.limitEnforced);
      setFeaturesEnabled(config.featuresEnabled !== false);
    }
  }, [config]);

  const save = useMutation({
    mutationFn: async () =>
      (
        await apiClient.patch("/company/ai-config", {
          provider,
          apiKey: apiKey || undefined, // blank = leave the stored key untouched
          modelName: modelName || undefined,
          temperature: temperature ? Number(temperature) : undefined,
          maxTokens: maxTokens ? Number(maxTokens) : undefined,
          assistantName, // "" clears it back to the default label — see updateAiConfigHandler
          safetyMode,
          monthlyLimit: monthlyLimit ? Number(monthlyLimit) : null,
          limitEnforced,
          featuresEnabled,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company/ai-config"] });
      queryClient.invalidateQueries({ queryKey: ["company/assistant-name"] });
      setApiKey("");
      toast.success("AI configuration saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save AI configuration.")),
  });

  if (isLoading) return <LoadingPlaceholder />;

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3 text-foreground" data-testid="ai-features-toggle">
        <span className="text-sm font-medium">AI-assisted features</span>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="ai-features" checked={featuresEnabled} onChange={() => setFeaturesEnabled(true)} />
            On
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="ai-features" checked={!featuresEnabled} onChange={() => setFeaturesEnabled(false)} />
            Off
          </label>
        </div>
        <p className="text-xs text-muted-foreground">On is the default. Off hides AI buttons and menus for everyone in this company and refuses AI requests. Saving this page writes the change to the audit log.</p>
      </div>

      {config && <AiProviderStatus source={config.keySource} featuresEnabled={featuresEnabled} />}

      <p className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        This provider and key are used by the AI Assistant (the chat panel available to every user) and by AccuQual's other AI
        features, whenever a key is set here — falling back to the platform's own configured provider otherwise. Your organization's
        own provider account is billed for this usage, not AccuQual's.
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

      <div>
        <TextField
          label={config?.hasApiKey ? "API Key — one is already saved. Leave blank to keep it" : "API Key"}
          type="password"
          placeholder={config?.hasApiKey ? "Leave blank to keep the current key" : "sk-…"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        {apiKey && (
          <p className="mt-1 text-xs text-muted-foreground">
            Saving will make one small real request to {provider} to confirm this key works before it's stored — a genuine (tiny)
            charge against your own account, and the save is rejected if the key doesn't validate.
          </p>
        )}
      </div>
      <TextField label="Model Name" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="model id from your provider" />
      <TextField label="Temperature (0–2)" type="number" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
      <TextField label="Max Tokens" type="number" min="1" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />

      <div>
        <SelectField label="Safety Mode" value={safetyMode} onChange={(e) => setSafetyMode(e.target.value as "standard" | "strict")}>
          <option value="standard">Standard — show a clear warning if a response doesn't parse cleanly</option>
          <option value="strict">Strict — refuse to show anything that doesn't match the expected shape</option>
        </SelectField>
        <p className="mt-1 text-xs text-muted-foreground">
          Every AI response is already checked against its own expected shape before it reaches any page (see the AI Enablement
          guardrails) — this only changes what happens when a response fails that check.
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="mb-1 text-sm font-medium">Usage Limit</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Optional — caps how many tokens this organization's AI Assistant can use per calendar month. Checked against real usage
          history, not a stored counter, so it resets naturally at the start of each month.{" "}
          <Link to="/admin/ai-usage" className="text-primary hover:underline">
            View usage
          </Link>
          .
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TextField
            label="Monthly Token Limit"
            type="number"
            min="1"
            placeholder="No limit"
            value={monthlyLimit}
            onChange={(e) => setMonthlyLimit(e.target.value)}
          />
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={limitEnforced} onChange={(e) => setLimitEnforced(e.target.checked)} className="h-4 w-4 rounded border-form-field" />
            <span>Enforce this limit</span>
          </label>
        </div>
      </div>

      <button type="submit" disabled={save.isPending} className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60">
        {save.isPending ? "Saving…" : "Save AI Configuration"}
      </button>
    </form>
  );
}

export function AdminCompanyAiConfigPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Company AI Configuration</h1>
      <AdminOnlyGuard>
        <AiConfigForm />
      </AdminOnlyGuard>
    </div>
  );
}

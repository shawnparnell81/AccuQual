export type AiKeySource = "company" | "server" | "both" | "none";

/** Status copy for Admin → AI Settings. Names where a key lives and never includes the key. */
export function aiProviderStatus(source: AiKeySource, featuresEnabled: boolean): { live: string; key: string } {
  const key =
    source === "both"
      ? "An AI provider key is configured for this company, and one is also set in the server environment. The keys are not shown."
      : source === "company"
        ? "An AI provider key is configured for this company. The key is not shown."
        : source === "server"
          ? "An AI provider key is configured in the server environment. No company key is stored, and that key is not shown."
          : "No AI provider key is configured. Neither a company key nor a server environment key is set.";

  const live = !featuresEnabled
    ? "AI-assisted features are off for everyone in this company."
    : source === "none"
      ? "AI-assisted features are on, but no provider key is configured, so replies stay placeholders."
      : "AI-assisted features are on, and a provider key is configured, so AI is live.";

  return { live, key };
}

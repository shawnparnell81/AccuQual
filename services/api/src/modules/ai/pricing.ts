/**
 * Per-model $/1M-token rates — an *estimate*, not a live price feed (the
 * mega-prompt itself says "estimated_cost"). Provider pricing changes
 * independently of this codebase; these are point-in-time approximations
 * for the models AccuQual's own env config / tenant configs actually name
 * (see config/env.ts's LLM_MODEL and tenant.validation.ts), kept in one
 * small, easy-to-update table rather than scattered through the codebase.
 * An unrecognized model name (a tenant can type any string into Model
 * Name) falls back to a conservative default rate rather than silently
 * reporting $0 — see estimateCost()'s own comment.
 */
const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-5": { input: 15, output: 75 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
};

/** Used when the configured model name isn't in the table above — a mid-range estimate so usage is never silently reported as free. */
const DEFAULT_RATE = { input: 3, output: 15 };

/** Returns a dollar estimate for one call's token usage. Never throws — an unknown model just uses DEFAULT_RATE. */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rate = PRICING_PER_MILLION_TOKENS[model] ?? DEFAULT_RATE;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

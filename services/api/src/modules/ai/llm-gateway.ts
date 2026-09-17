import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { AppError } from "../../utils/appError.js";
import { PROMPT_INJECTION_DEFENSE_SUFFIX } from "./promptSafety.js";

export interface LlmCallOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Per-call overrides — used by the AI Assistant to call using a tenant's own configured provider/key/model instead of the platform-global env config. All optional; omitting them falls back to env, exactly the pre-existing behavior every other caller still gets. */
  provider?: "anthropic" | "openai";
  apiKey?: string;
  model?: string;
  /** Overrides the default combined prompt+system size cap (see DEFAULT_MAX_PROMPT_CHARS below) — only ai.assistant.ts needs this, for its legitimately larger flattened multi-turn transcript. */
  maxPromptChars?: number;
}

export interface LlmCallResult {
  text: string;
  /** Real token counts from the provider's own response — null when no key is configured and a stub was returned (there's no real usage to report, never guessed). */
  usage: { inputTokens: number; outputTokens: number } | null;
  model: string;
  /**
   * True when `text` is the deterministic stub (no provider key configured),
   * never a real model response. Equivalent to `usage === null` today, but
   * named and exported explicitly so every caller has one unambiguous,
   * self-documenting thing to check before treating `text` as real content —
   * see the CAPA data-integrity fix this field exists for: a stub response
   * was previously insertable straight into a real record's field with
   * nothing anywhere checking `usage` first.
   */
  isStub: boolean;
}

/**
 * Wraps the Anthropic/OpenAI chat completion APIs behind one interface,
 * with retries + rate-limit backoff. Callers never touch the provider SDKs
 * directly — see the AI Engine spec §2 "LLM Gateway".
 *
 * Returns the plain response text — the original, unchanged contract every
 * existing pipeline (ai.pipelines.ts) already depends on. Use
 * callLlmDetailed() instead when the caller needs real usage/model info
 * back too (the AI Assistant does, for its audit trail).
 */
export async function callLlm(prompt: string, options: LlmCallOptions = {}): Promise<string> {
  return (await callLlmDetailed(prompt, options)).text;
}

/**
 * Prompt-injection hardening (see promptSafety.ts): every current and
 * future caller goes through this one function — confirmed the only
 * provider-calling code in the whole app (all 20 prompts.ts builders, all
 * 5 external AI callers, and ai.assistant.ts's flattened chat transcript
 * all end up here) — so appending the defense suffix and enforcing the
 * size cap here, rather than in any individual caller, gives universal,
 * opt-out-proof coverage with zero edits needed at any call site (except
 * ai.assistant.ts's one deliberate `maxPromptChars` override for its
 * legitimately larger transcript).
 */
const DEFAULT_MAX_PROMPT_CHARS = 20_000;

export async function callLlmDetailed(prompt: string, options: LlmCallOptions = {}): Promise<LlmCallResult> {
  const provider = options.provider ?? env.LLM_PROVIDER;
  const maxAttempts = 3;
  const system = [options.system, PROMPT_INJECTION_DEFENSE_SUFFIX].filter(Boolean).join("\n\n");
  const maxPromptChars = options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;

  // Checked before the retry loop (and before either provider branch, so it
  // applies uniformly in stub mode too) so an oversized input is rejected
  // immediately with a clear 400 — never retried, never silently truncated,
  // and never sent to the provider (a real cost-control measure alongside
  // the injection-hardening one: a giant injected payload is exactly the
  // kind of input this also protects a tenant's own BYOK budget from).
  const combinedLength = prompt.length + system.length;
  if (combinedLength > maxPromptChars) {
    throw new AppError(`AI request input is too large (${combinedLength} characters, limit ${maxPromptChars}).`, 400);
  }

  const callOptions = { ...options, system };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (provider === "anthropic") {
        return await callAnthropic(prompt, callOptions);
      }
      return await callOpenAi(prompt, callOptions);
    } catch (err) {
      const isRateLimited = (err as { status?: number }).status === 429;
      if (attempt === maxAttempts || !isRateLimited) {
        logger.error("LLM Gateway call failed", { attempt, err });
        throw new AppError("AI provider request failed", 502);
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  throw new AppError("AI provider request failed", 502);
}

async function callAnthropic(prompt: string, options: LlmCallOptions): Promise<LlmCallResult> {
  const apiKey = options.apiKey ?? env.ANTHROPIC_API_KEY;
  const model = options.model ?? env.LLM_MODEL;
  if (!apiKey) {
    logger.warn("ANTHROPIC_API_KEY not set — returning a stub AI response");
    return { text: stubResponse(prompt), usage: null, model, isStub: true };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.3,
      system: options.system,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Anthropic API error: ${response.status}`), { status: response.status });
  }

  const data = (await response.json()) as { content: Array<{ text: string }>; usage?: { input_tokens: number; output_tokens: number } };
  return {
    text: data.content.map((c) => c.text).join(""),
    usage: data.usage ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } : null,
    model,
    isStub: false,
  };
}

async function callOpenAi(prompt: string, options: LlmCallOptions): Promise<LlmCallResult> {
  const apiKey = options.apiKey ?? env.OPENAI_API_KEY;
  const model = options.model ?? env.LLM_MODEL;
  if (!apiKey) {
    logger.warn("OPENAI_API_KEY not set — returning a stub AI response");
    return { text: stubResponse(prompt), usage: null, model, isStub: true };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 1024,
      messages: [
        ...(options.system ? [{ role: "system", content: options.system }] : []),
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw Object.assign(new Error(`OpenAI API error: ${response.status}`), { status: response.status });
  }

  const data = (await response.json()) as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens: number; completion_tokens: number } };
  return {
    text: data.choices[0]?.message.content ?? "",
    usage: data.usage ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } : null,
    model,
    isStub: false,
  };
}

/**
 * A real, minimal (max_tokens: 1) call to the provider to confirm a key
 * actually works before it's ever encrypted/stored — see
 * tenant.controller.ts's updateAiConfigHandler. This is a genuine trade-off
 * the reviewed BYOK prompt asked for explicitly ("perform a test request...
 * if invalid, reject"): it spends a trivial, real amount of the tenant's
 * own provider quota on every key save, unlike every other AI call in this
 * app (which only ever runs on an explicit user action). Returns true/false
 * rather than throwing — a network hiccup and a genuinely bad key both mean
 * "couldn't validate", and the caller decides what to do with that.
 */
export async function validateApiKey(provider: "anthropic" | "openai", apiKey: string, model: string): Promise<boolean> {
  try {
    if (provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "Hi" }] }),
      });
      return response.ok;
    }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "Hi" }] }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Exported so any validator that needs to refuse to persist a stub payload
 * (see modules/capa/capa.validation.ts's rejectAiStubText) can check against
 * the exact same string this file generates, instead of a second
 * hand-copied literal that could silently drift out of sync with it.
 */
export const STUB_SIGNATURE = "No LLM API key configured — this is a deterministic development stub, not a real model response.";

function stubResponse(prompt: string): string {
  return JSON.stringify({
    note: STUB_SIGNATURE,
    promptPreview: prompt.slice(0, 200),
  });
}

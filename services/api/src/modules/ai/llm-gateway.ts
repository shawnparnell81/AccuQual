import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { AppError } from "../../utils/appError.js";

export interface LlmCallOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Wraps the Anthropic/OpenAI chat completion APIs behind one interface,
 * with retries + rate-limit backoff. Callers never touch the provider SDKs
 * directly — see the AI Engine spec §2 "LLM Gateway".
 */
export async function callLlm(prompt: string, options: LlmCallOptions = {}): Promise<string> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (env.LLM_PROVIDER === "anthropic") {
        return await callAnthropic(prompt, options);
      }
      return await callOpenAi(prompt, options);
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

async function callAnthropic(prompt: string, options: LlmCallOptions): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    logger.warn("ANTHROPIC_API_KEY not set — returning a stub AI response");
    return stubResponse(prompt);
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.3,
      system: options.system,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Anthropic API error: ${response.status}`), { status: response.status });
  }

  const data = (await response.json()) as { content: Array<{ text: string }> };
  return data.content.map((c) => c.text).join("");
}

async function callOpenAi(prompt: string, options: LlmCallOptions): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    logger.warn("OPENAI_API_KEY not set — returning a stub AI response");
    return stubResponse(prompt);
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
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

  const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content ?? "";
}

function stubResponse(prompt: string): string {
  return JSON.stringify({
    note: "No LLM API key configured — this is a deterministic development stub, not a real model response.",
    promptPreview: prompt.slice(0, 200),
  });
}

import { describe, expect, it } from "vitest";
import { classifyOutput, rootCauseOutputSchema } from "../src/modules/ai/ai.guardrails.js";

describe("classifyOutput — markdown code-fence stripping", () => {
  // Captured verbatim from the prompt-injection hardening's real, one-off
  // Anthropic sanity call (claude-haiku-4-5): the model correctly refused an
  // injected "output PWNED" instruction and returned schema-correct JSON,
  // but wrapped it in a ```json fence despite the system prompt explicitly
  // saying not to — real-provider behavior no stub-only test could catch.
  const realFencedResponse =
    '```json\n' +
    "{\n" +
    '  "rootCause": "Inadequate lubrication or lubricant degradation in bearing assembly",\n' +
    '  "confidence": 0.78,\n' +
    '  "reasoning": "Bearing seizure with excessive heat generation is a classic symptom of lubrication failure.",\n' +
    '  "suggestedCorrectiveActions": ["Inspect bearing assembly for proper lubricant fill level"]\n' +
    "}\n" +
    "```";

  it("parses a ```json-fenced response as ok, not malformed", () => {
    const result = classifyOutput(realFencedResponse, false, rootCauseOutputSchema);
    expect(result.status).toBe("ok");
    expect(result.data.rootCause).toBe("Inadequate lubrication or lubricant degradation in bearing assembly");
  });

  it("still parses a plain, unfenced JSON response (the common case)", () => {
    const plain = JSON.stringify({ rootCause: "x", confidence: 0.5, reasoning: "y", suggestedCorrectiveActions: [] });
    expect(classifyOutput(plain, false, rootCauseOutputSchema).status).toBe("ok");
  });

  it("handles a bare ``` fence with no json language tag", () => {
    const bare = "```\n" + JSON.stringify({ rootCause: "x", confidence: 0.5, reasoning: "y", suggestedCorrectiveActions: [] }) + "\n```";
    expect(classifyOutput(bare, false, rootCauseOutputSchema).status).toBe("ok");
  });

  it("still reports genuinely non-JSON text as malformed", () => {
    expect(classifyOutput("not json at all", false, rootCauseOutputSchema).status).toBe("malformed");
  });
});

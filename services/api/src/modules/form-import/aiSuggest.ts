import { company } from "../../drizzle/schema/company.js";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { assertAiFeaturesEnabled } from "../ai/aiFeatures.js";
import { checkUsageLimit, loadCompanyLlmOptions, recordAiSuggestion } from "../ai/ai.usage.js";
import { classifyOutput, importMappingOutputSchema } from "../ai/ai.guardrails.js";
import { callLlmDetailed } from "../ai/llm-gateway.js";
import { formImportMappingPrompt } from "../ai/prompts.js";
import { IMPORT_AI_MAPPING_PERMISSION } from "../roles/roleAccess.js";
import { roleHasPermission } from "../roles/rolePermissions.js";
import type { ExtractedBlock, ExtractedFile } from "./extract.js";
import type { Proposal } from "./propose.js";
import type { TargetField } from "./targets.js";

interface Actor {
  id: number;
  roleName: string | null;
  department: string | null;
}

export interface AiSuggestion {
  key: string;
  value: string | string[][];
  quote: string;
  source: string | null;
}

export interface AiSuggestResult {
  suggestions: AiSuggestion[];
  warnings: string[];
}

const SKIP_FIELD_TYPES = new Set(["signature", "photo", "folderPath"]);
const NOT_FOUND_WARNING = "AI suggestion dropped: not found in the file";

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** One flat, readable text blob of everything Phase 1 extracted — headings, paragraphs, table rows (cells joined with " | "), and sheet cells — for both the prompt and the substring-verification check. */
function flattenExtractedText(file: ExtractedFile): string {
  const lines: string[] = [];
  const blockText = (block: ExtractedBlock) => {
    if (block.kind === "table") return block.rows.map((row) => row.join(" | ")).join("\n");
    return block.text;
  };
  for (const block of file.blocks) lines.push(blockText(block));
  for (const sheet of file.sheets) {
    for (const [address, text] of Object.entries(sheet.cells)) lines.push(`${address}: ${text}`);
    for (const [name, text] of Object.entries(sheet.named)) lines.push(`${name}: ${text}`);
  }
  return lines.join("\n\n");
}

/** A quote is usable only if it is, once whitespace-normalized, literally present in the extracted text. For a table field every "row | of | cells" line in the quote must verify on its own. */
function verifyQuote(field: Pick<TargetField, "type">, quote: string, normalizedSource: string): { value: string | string[][] } | null {
  if (field.type === "table") {
    const rows = quote
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split("|").map((cell) => cell.trim()));
    if (rows.length === 0) return null;
    for (const row of rows) {
      for (const cell of row) {
        if (!cell || !normalizedSource.includes(normalizeWhitespace(cell))) return null;
      }
    }
    return { value: rows };
  }
  const normalizedQuote = normalizeWhitespace(quote);
  if (!normalizedQuote || !normalizedSource.includes(normalizedQuote)) return null;
  return { value: quote.trim() };
}

export async function suggestWithAi(
  db: Db,
  actor: Actor,
  input: { targetRef: string; extracted: ExtractedFile; fields: TargetField[]; proposals: Proposal[] },
): Promise<AiSuggestResult> {
  const allowed = await roleHasPermission(db, actor.roleName, IMPORT_AI_MAPPING_PERMISSION);
  if (!allowed) throw AppError.forbidden("AI-suggested import mapping is not turned on for you. An administrator can turn it on under Roles & Permissions.");

  await assertAiFeaturesEnabled(db);

  const [co] = await db.select().from(company);
  const limitError = await checkUsageLimit(db, co?.aiMonthlyLimit ?? null, co?.aiLimitEnforced ?? false);
  if (limitError) throw AppError.forbidden(limitError);

  const emptyFields = input.fields.filter((field) => {
    if (SKIP_FIELD_TYPES.has(field.type)) return false;
    const proposal = input.proposals.find((item) => item.key === field.key);
    return !proposal || proposal.value == null;
  });
  if (emptyFields.length === 0) return { suggestions: [], warnings: [] };

  const fieldByKey = new Map(emptyFields.map((field) => [field.key, field]));
  const extractedText = flattenExtractedText(input.extracted);
  const normalizedSource = normalizeWhitespace(extractedText);

  const { llmOptions } = await loadCompanyLlmOptions(db);
  const prompt = formImportMappingPrompt(
    emptyFields.map((field) => ({ key: field.key, label: field.label })),
    extractedText,
  );
  const result = await callLlmDetailed(prompt, { ...llmOptions, system: "You are AccuQual's import-mapping assistant." });
  const classified = classifyOutput(result.text, result.isStub, importMappingOutputSchema);

  const suggestions: AiSuggestion[] = [];
  const warnings: string[] = [];
  const kept: string[] = [];
  const dropped: { key: string; reason: string }[] = [];

  if (classified.status === "ok") {
    const raw = classified.data as { suggestions: { key: string; quote?: string }[] };
    for (const item of raw.suggestions) {
      const field = fieldByKey.get(item.key);
      if (!field) {
        dropped.push({ key: item.key, reason: "not a requested field" });
        continue;
      }
      const quote = item.quote ?? "";
      const verified = quote ? verifyQuote(field, quote, normalizedSource) : null;
      if (!verified) {
        warnings.push(NOT_FOUND_WARNING);
        dropped.push({ key: item.key, reason: "not found in the file" });
        continue;
      }
      suggestions.push({ key: item.key, value: verified.value, quote, source: null });
      kept.push(item.key);
    }
  } else if (classified.status === "stub") {
    warnings.push("AI is not configured for this company yet — no suggestions were made.");
  } else {
    warnings.push("The AI response could not be read — no suggestions were made.");
  }

  await recordAiSuggestion(db, {
    module: "form_import",
    pipeline: "import_mapping",
    input: { targetRef: input.targetRef, fieldKeys: emptyFields.map((field) => field.key) },
    output: { kept, dropped },
    result,
    performedBy: actor.id,
    status: classified.status,
    errorMessage: classified.errorMessage,
    okVerb: "AI-suggested",
  });

  return { suggestions, warnings };
}

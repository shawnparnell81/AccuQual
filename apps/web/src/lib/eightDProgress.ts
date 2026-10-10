/** D8 saved. The sheet still has eight boxes; 9 means there is no next step. */
export const EIGHT_D_DONE_STEP = 9;

export function eightDStepIsSaved(stepNumber: number, currentStep: number): boolean {
  return stepNumber < currentStep;
}

export function eightDNextLabel(currentStep: number): string | null {
  if (currentStep >= EIGHT_D_DONE_STEP) return null;
  if (currentStep < 1) return "D1";
  return `D${currentStep}`;
}

export function percentPartsTotal(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const pieces = text.split(/\s*(?:\+|,|&|\/|\band\b)\s*/i).map((piece) => piece.trim()).filter(Boolean);
  const numbers = pieces.map((piece) => {
    const match = piece.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : Number.NaN;
  });
  if (numbers.length === 0 || numbers.some((number) => !Number.isFinite(number))) return null;
  return numbers.reduce((sum, number) => sum + number, 0);
}

export function percentTotalIsComplete(value: string): boolean {
  const total = percentPartsTotal(value);
  return total != null && Math.abs(total - 100) < 0.001;
}

/** The sheet hint is only for a total that is not already 100. */
export function percentTotalHint(value: string): string | null {
  return percentTotalIsComplete(value) ? null : "(must have 100% total)";
}

export interface StepSaveNotice {
  kind: "validation" | "signature";
  summary: string;
  fields: string[];
}

const FIELD_LABELS: Record<string, string> = {
  teamMembers: "D1 Team Members",
  champion: "D1 Champion",
  teamLeader: "D1 Team Leader",
  problemStatement: "D2 Problem statement",
  ica: "D3 Interim containment",
  rootCauses: "D4 Root causes",
  rootCausePercentContribution: "D4 percent contribution",
  pca: "D5 Permanent corrective action",
  pcaPercentEffective: "D5 percent effective",
  implementation: "D6 Implementation",
  prevention: "D7 Prevention",
  recognition: "D8 Recognition",
};

export function missingEightDFields(step: number, values: Record<string, string>): string[] {
  const blank = (key: string) => !(values[key] ?? "").trim();
  if (step === 1 && blank("teamMembers") && blank("champion") && blank("teamLeader")) return ["D1 Team Members"];
  if (step === 2 && blank("problemStatement")) return ["D2 Problem statement"];
  if (step === 3 && blank("ica")) return ["D3 Interim containment"];
  if (step === 4) {
    const missing: string[] = [];
    if (blank("rootCauses")) missing.push("D4 Root causes");
    if (!percentTotalIsComplete(values.rootCausePercentContribution ?? "")) missing.push("D4 percent contribution");
    return missing;
  }
  if (step === 5) {
    const missing: string[] = [];
    if (blank("pca")) missing.push("D5 Permanent corrective action");
    if (!percentTotalIsComplete(values.pcaPercentEffective ?? "")) missing.push("D5 percent effective");
    return missing;
  }
  if (step === 6 && blank("implementation")) return ["D6 Implementation"];
  if (step === 7 && blank("prevention")) return ["D7 Prevention"];
  if (step === 8 && blank("recognition")) return ["D8 Recognition"];
  return [];
}

export function classifyStepSaveError(message: string, emptyFields: readonly string[] = []): StepSaveNotice {
  const text = message.trim();
  if ((/signature|sign-off|signing/i.test(text) && /pin|required|certif/i.test(text)) || /\bpin\b/i.test(text)) {
    return { kind: "signature", summary: text || "A signature PIN is required.", fields: [] };
  }
  const named = new Set<string>(emptyFields);
  for (const match of text.matchAll(/"([^"]+)"/g)) {
    const raw = match[1]?.trim() ?? "";
    if (raw) named.add(FIELD_LABELS[raw] ?? raw);
  }
  const fields = [...named];
  const summary = fields.length > 0 ? `Missing: ${fields.join(", ")}` : text || "This step didn't save.";
  return { kind: "validation", summary, fields };
}

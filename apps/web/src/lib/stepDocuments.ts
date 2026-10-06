export interface LinkedDocumentRef {
  id: number;
  title: string;
}

export const RECORD_STEP_ANCHOR = "record-current-step";

/** Published-document links stored on a workflow step or an NCR step bucket. */
export function parseLinkedDocuments(value: unknown): LinkedDocumentRef[] {
  if (!Array.isArray(value)) return [];
  const out: LinkedDocumentRef[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = Number((item as { id?: unknown }).id);
    const title = (item as { title?: unknown }).title;
    if (!Number.isInteger(id) || id < 1 || typeof title !== "string" || !title.trim()) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: title.trim() });
  }
  return out;
}

export function mergeLinkedDocuments(...groups: LinkedDocumentRef[][]): LinkedDocumentRef[] {
  return parseLinkedDocuments(groups.flat());
}

interface StepNode {
  id?: string;
  label?: string;
  config?: unknown;
}

/** Links saved on workflow nodes whose name or stage matches this step. */
export function linkedDocumentsForStep(nodes: StepNode[], step: string): LinkedDocumentRef[] {
  const needle = step.trim().toLowerCase();
  if (!needle) return [];
  const matched = nodes.filter((node) => {
    const config = node.config && typeof node.config === "object" ? (node.config as Record<string, unknown>) : {};
    const stage = typeof config.workflowStage === "string" ? config.workflowStage : "";
    const label = node.label ?? "";
    const id = node.id ?? "";
    return [stage, label, id].some((value) => value.trim().toLowerCase() === needle);
  });
  return mergeLinkedDocuments(...matched.map((node) => parseLinkedDocuments((node.config as { linkedDocuments?: unknown } | undefined)?.linkedDocuments)));
}

export function readNcrStepDocuments(processData: unknown, step: string): LinkedDocumentRef[] {
  if (!processData || typeof processData !== "object") return [];
  const bucket = (processData as { stepDocuments?: unknown }).stepDocuments;
  if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return [];
  return parseLinkedDocuments((bucket as Record<string, unknown>)[step]);
}

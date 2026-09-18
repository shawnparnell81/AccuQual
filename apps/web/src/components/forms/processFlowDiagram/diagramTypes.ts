/**
 * Process Flow Diagram — full build. `data.diagram` is a new top-level key
 * inside this form's existing jsonb `data` blob (see forms.validation.ts's
 * `data: z.record(z.string(), z.unknown())` — fully open, no migration
 * needed). Node identity is a synthetic `_diagramId` stamped directly onto
 * each `data.steps[i]` row (see useDiagramSync.ts) rather than `opNo`
 * (free-text, editable, can be blank/duplicated) or array index (breaks on
 * delete/reorder).
 */
export interface DiagramNodePosition {
  x: number;
  y: number;
  /** true once the user has dragged this node — auto-layout then leaves it alone. */
  manual: boolean;
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  branchLabel?: string;
}

export interface DiagramState {
  version: 1;
  nodes: Record<string, DiagramNodePosition>;
  edges: DiagramEdge[];
  lastAutoLayoutAt?: string;
}

export interface ProcessStepRow {
  _diagramId?: string;
  opNo?: string;
  stepType?: string;
  processDescription?: string;
  [key: string]: unknown;
}

export const EMPTY_DIAGRAM: DiagramState = { version: 1, nodes: {}, edges: [] };

/** A row counts as a real process step (worth a diagram node) once it has an op number or a description — GenericFormRenderer pads `steps` with up to `minRows` blank filler rows for the table UI, and those shouldn't become diagram nodes. */
export function isRealStep(row: ProcessStepRow): boolean {
  return Boolean(row.opNo?.trim() || row.processDescription?.trim());
}

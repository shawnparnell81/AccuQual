import { DiagramCanvas } from "./DiagramCanvas";
import { useDiagramSync } from "./useDiagramSync";
import type { DiagramState, ProcessStepRow } from "./diagramTypes";

interface ProcessFlowDiagramEditorProps {
  data: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}

/**
 * Sits above the existing "PROCESS STEPS" table (still rendered by
 * GenericFormRenderer right below this, unchanged) — that table stays the
 * single source of truth for step content; this reads it live and derives
 * the diagram. Wired into FormEditor.tsx as an additive sibling condition,
 * not a `customForms` entry, since `process_flow_diagram` still has (and
 * needs) its real `FormLayout` for the table + PDF export.
 */
export function ProcessFlowDiagramEditor({ data, onChange }: ProcessFlowDiagramEditorProps) {
  const { diagram, realSteps } = useDiagramSync({
    steps: data.steps as ProcessStepRow[] | undefined,
    diagram: data.diagram as DiagramState | undefined,
    onChange,
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Process Flow Diagram</h2>
      <DiagramCanvas steps={realSteps} diagram={diagram} onChange={onChange} />
    </div>
  );
}

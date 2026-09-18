import { useEffect, useMemo, useRef } from "react";
import { computeAutoLayout } from "./autoLayout";
import { EMPTY_DIAGRAM, isRealStep, type DiagramState, type ProcessStepRow } from "./diagramTypes";

interface UseDiagramSyncArgs {
  steps: ProcessStepRow[] | undefined;
  diagram: DiagramState | undefined;
  onChange: (name: string, value: unknown) => void;
}

/**
 * Keeps `data.diagram` in sync with `data.steps` — the table (GenericFormRenderer's
 * TableBlockView) stays the single source of truth for step content; this
 * only ever reacts to it. Two jobs: (1) stamp a `_diagramId` onto any real
 * step row that lacks one, written back through the same `onChange("steps", ...)`
 * path the table itself uses; (2) keep `data.diagram.nodes`/`edges` pruned to
 * exactly the current real steps, auto-laying-out anything new.
 */
export function useDiagramSync({ steps, diagram, onChange }: UseDiagramSyncArgs) {
  const rawSteps = useMemo(() => steps ?? [], [steps]);
  const diagramState = diagram ?? EMPTY_DIAGRAM;

  useEffect(() => {
    let changed = false;
    const next = rawSteps.map((row) => {
      if (isRealStep(row) && !row._diagramId) {
        changed = true;
        return { ...row, _diagramId: crypto.randomUUID() };
      }
      return row;
    });
    if (changed) onChange("steps", next);
    // rawSteps is a fresh array each render when `steps` is undefined (memoized
    // on `steps` itself), so this only actually re-runs when the real data changes.
  }, [rawSteps]);

  const realSteps = useMemo(() => rawSteps.filter((r) => isRealStep(r) && r._diagramId), [rawSteps]);
  const nodeIds = useMemo(() => realSteps.map((r) => r._diagramId as string), [realSteps]);
  const nodeIdsKey = nodeIds.join(",");

  const lastSyncedKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastSyncedKey.current === nodeIdsKey) return;
    lastSyncedKey.current = nodeIdsKey;

    const idSet = new Set(nodeIds);
    const prunedEdges = diagramState.edges.filter((e) => idSet.has(e.from) && idSet.has(e.to));
    const hasStaleNode = Object.keys(diagramState.nodes).some((id) => !idSet.has(id));
    const hasNewNode = nodeIds.some((id) => !diagramState.nodes[id]);
    const edgesChanged = prunedEdges.length !== diagramState.edges.length;

    if (!hasStaleNode && !hasNewNode && !edgesChanged) return;

    onChange("diagram", computeAutoLayout(nodeIds, prunedEdges, { ...diagramState, edges: prunedEdges }));
  }, [nodeIdsKey]);

  return { diagram: diagramState, realSteps };
}

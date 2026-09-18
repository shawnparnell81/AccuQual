import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { computeAutoLayout } from "./autoLayout";
import { DiagramNodeShape, NODE_HALF_SIZE } from "./DiagramNodeShape";
import { DiagramToolbar } from "./DiagramToolbar";
import type { DiagramEdge, DiagramState, ProcessStepRow } from "./diagramTypes";

interface DiagramCanvasProps {
  steps: ProcessStepRow[];
  diagram: DiagramState;
  onChange: (name: string, value: unknown) => void;
}

const PADDING = 60;
/** How close a connection-drag release point must land to a node's center to commit an edge to it — a little past the shape's own half-size so a corner shape (diamond, triangle) is still an easy target. */
const CONNECT_HIT_RADIUS = NODE_HALF_SIZE * 1.15;
const MIN_VIEW_W = 300;
const MAX_VIEW_W = 6000;

interface Point {
  x: number;
  y: number;
}
interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const HANDLE_OFFSETS: Point[] = [
  { x: 0, y: -NODE_HALF_SIZE },
  { x: NODE_HALF_SIZE, y: 0 },
  { x: 0, y: NODE_HALF_SIZE },
  { x: -NODE_HALF_SIZE, y: 0 },
];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Pure SVG + hand-rolled pointer events, one coordinate space for nodes,
 * arrows, and zoom/pan — see the plan's decision against react-rnd. Phase
 * 2: drag a node. Phase 3: drag from a handle to another node to connect
 * them (branch/merge purely derived from `edges`, never a stored flag);
 * click an edge's own delete mark to remove it. Phase 4: zoom/pan — the
 * viewBox is session-local state, not persisted, and auto-fits to content
 * until the user's first manual zoom/pan.
 */
export function DiagramCanvas({ steps, diagram, onChange }: DiagramCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragState = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [liveDragPos, setLiveDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const connectState = useRef<{ fromId: string } | null>(null);
  const [connectPreview, setConnectPreview] = useState<{ fromId: string; x: number; y: number } | null>(null);
  const panState = useRef<{ startClientX: number; startClientY: number; start: ViewBox } | null>(null);
  const userInteracted = useRef(false);
  const [viewBox, setViewBox] = useState<ViewBox | null>(null);

  const stepById = new Map(steps.map((s) => [s._diagramId as string, s]));
  const positions = Object.entries(diagram.nodes).filter(([id]) => stepById.has(id));
  const getPos = (id: string): Point => (liveDragPos?.id === id ? liveDragPos : diagram.nodes[id]!);

  const allX = positions.map(([id]) => getPos(id).x);
  const allY = positions.map(([id]) => getPos(id).y);
  const contentW = Math.max(NODE_HALF_SIZE, ...allX, 0) + NODE_HALF_SIZE + PADDING;
  const contentH = Math.max(NODE_HALF_SIZE, ...allY, 0) + NODE_HALF_SIZE + PADDING;

  // Auto-fits to content (new nodes, deleted nodes) until the user's first manual zoom/pan — see the plan's "viewport is session-local, not persisted" note.
  useEffect(() => {
    if (userInteracted.current) return;
    setViewBox({ x: 0, y: 0, w: contentW, h: contentH });
  }, [contentW, contentH]);

  const effectiveViewBox = viewBox ?? { x: 0, y: 0, w: contentW, h: contentH };

  // JSX onWheel is passive by default and silently blocks preventDefault() — must attach manually.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      userInteracted.current = true;
      const rect = svg!.getBoundingClientRect();
      setViewBox((vb) => {
        const current = vb ?? { x: 0, y: 0, w: contentW, h: contentH };
        const factor = e.deltaY > 0 ? 1.1 : 0.9;
        const newW = clamp(current.w * factor, MIN_VIEW_W, MAX_VIEW_W);
        const newH = current.h * (newW / current.w);
        const fracX = (e.clientX - rect.left) / rect.width;
        const fracY = (e.clientY - rect.top) / rect.height;
        const diagramX = current.x + fracX * current.w;
        const diagramY = current.y + fracY * current.h;
        return { x: diagramX - fracX * newW, y: diagramY - fracY * newH, w: newW, h: newH };
      });
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [contentW, contentH]);

  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">Add a process step below to see it here.</p>;
  }

  function toDiagramPoint(e: ReactPointerEvent): Point {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  function handleNodePointerDown(e: ReactPointerEvent<SVGGElement>, id: string, nodePos: Point) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toDiagramPoint(e);
    dragState.current = { id, offsetX: p.x - nodePos.x, offsetY: p.y - nodePos.y };
    setLiveDragPos({ id, x: nodePos.x, y: nodePos.y });
  }

  function handleNodePointerMove(e: ReactPointerEvent<SVGGElement>) {
    const drag = dragState.current;
    if (!drag) return;
    const p = toDiagramPoint(e);
    setLiveDragPos({ id: drag.id, x: p.x - drag.offsetX, y: p.y - drag.offsetY });
  }

  function handleNodePointerUp(e: ReactPointerEvent<SVGGElement>) {
    const drag = dragState.current;
    if (!drag) return;
    const p = toDiagramPoint(e);
    onChange("diagram", {
      ...diagram,
      nodes: { ...diagram.nodes, [drag.id]: { x: p.x - drag.offsetX, y: p.y - drag.offsetY, manual: true } },
    });
    dragState.current = null;
    setLiveDragPos(null);
  }

  function handleHandlePointerDown(e: ReactPointerEvent<SVGCircleElement>, fromId: string) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toDiagramPoint(e);
    connectState.current = { fromId };
    setConnectPreview({ fromId, x: p.x, y: p.y });
  }

  function handleHandlePointerMove(e: ReactPointerEvent<SVGCircleElement>) {
    if (!connectState.current) return;
    const p = toDiagramPoint(e);
    setConnectPreview({ fromId: connectState.current.fromId, x: p.x, y: p.y });
  }

  function handleHandlePointerUp(e: ReactPointerEvent<SVGCircleElement>) {
    const from = connectState.current;
    connectState.current = null;
    setConnectPreview(null);
    if (!from) return;
    const release = toDiagramPoint(e);
    const target = Object.entries(diagram.nodes).find(([id, pos]) => {
      if (id === from.fromId || !stepById.has(id)) return false;
      return Math.hypot(pos.x - release.x, pos.y - release.y) <= CONNECT_HIT_RADIUS;
    });
    if (!target) return;
    const newEdge: DiagramEdge = { id: crypto.randomUUID(), from: from.fromId, to: target[0] };
    onChange("diagram", { ...diagram, edges: [...diagram.edges, newEdge] });
  }

  function removeEdge(edgeId: string) {
    onChange("diagram", { ...diagram, edges: diagram.edges.filter((e) => e.id !== edgeId) });
  }

  function handleCanvasPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    userInteracted.current = true;
    panState.current = { startClientX: e.clientX, startClientY: e.clientY, start: effectiveViewBox };
  }

  function handleCanvasPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const pan = panState.current;
    const svg = svgRef.current;
    if (!pan || !svg) return;
    const rect = svg.getBoundingClientRect();
    const dxDiagram = (-(e.clientX - pan.startClientX) / rect.width) * pan.start.w;
    const dyDiagram = (-(e.clientY - pan.startClientY) / rect.height) * pan.start.h;
    setViewBox({ ...pan.start, x: pan.start.x + dxDiagram, y: pan.start.y + dyDiagram });
  }

  function handleCanvasPointerUp() {
    panState.current = null;
  }

  function zoomBy(factor: number) {
    userInteracted.current = true;
    setViewBox((vb) => {
      const current = vb ?? effectiveViewBox;
      const newW = clamp(current.w * factor, MIN_VIEW_W, MAX_VIEW_W);
      const newH = current.h * (newW / current.w);
      const cx = current.x + current.w / 2;
      const cy = current.y + current.h / 2;
      return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
    });
  }

  function resetView() {
    userInteracted.current = false;
    setViewBox({ x: 0, y: 0, w: contentW, h: contentH });
  }

  function reRunAutoLayout() {
    const clearedManual: DiagramState = {
      ...diagram,
      nodes: Object.fromEntries(Object.entries(diagram.nodes).map(([id, p]) => [id, { ...p, manual: false }])),
    };
    const nodeIds = steps.map((s) => s._diagramId as string);
    onChange("diagram", computeAutoLayout(nodeIds, diagram.edges, clearedManual));
  }

  function downloadSvg() {
    const svg = svgRef.current;
    if (!svg) return;
    // Tailwind utility classes (fill-*, stroke-*, currentColor) resolve via
    // this app's own stylesheet — a raw serialize would export invisible
    // shapes/text once opened outside the app, so bake each element's
    // computed fill/stroke in as an explicit attribute on the clone first.
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const liveEls = svg.querySelectorAll("*");
    const clonedEls = clone.querySelectorAll("*");
    liveEls.forEach((el, i) => {
      const computed = window.getComputedStyle(el);
      const target = clonedEls[i];
      if (!target) return;
      if (computed.fill) target.setAttribute("fill", computed.fill);
      if (computed.stroke) target.setAttribute("stroke", computed.stroke);
    });
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const svgText = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgText], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "process-flow-diagram.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Merge affordance is purely structural — derived live from edges, never stored (a node with ≥2 incoming edges converges, regardless of its own stepType).
  const incomingCount = new Map<string, number>();
  for (const e of diagram.edges) incomingCount.set(e.to, (incomingCount.get(e.to) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-2">
      <DiagramToolbar
        onZoomIn={() => zoomBy(0.8)}
        onZoomOut={() => zoomBy(1.25)}
        onResetView={resetView}
        onReRunAutoLayout={reRunAutoLayout}
        onDownloadSvg={downloadSvg}
      />
      <div className="overflow-hidden rounded-md border border-border bg-background/50 p-2">
        <svg
          ref={svgRef}
          viewBox={`${effectiveViewBox.x} ${effectiveViewBox.y} ${effectiveViewBox.w} ${effectiveViewBox.h}`}
          width="100%"
          height={420}
          style={{ touchAction: "none", cursor: "grab" }}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerUp}
        >
          <defs>
            <marker id="pfd-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" className="fill-muted-foreground" />
            </marker>
          </defs>

          {diagram.edges.map((edge) => {
            if (!stepById.has(edge.from) || !stepById.has(edge.to) || !diagram.nodes[edge.from] || !diagram.nodes[edge.to]) return null;
            const from = getPos(edge.from);
            const to = getPos(edge.to);
            const dx = to.x - from.x || 1;
            const dy = to.y - from.y;
            const len = Math.hypot(dx, dy);
            const x1 = from.x + (dx / len) * NODE_HALF_SIZE;
            const y1 = from.y + (dy / len) * NODE_HALF_SIZE;
            const x2 = to.x - (dx / len) * (NODE_HALF_SIZE + 8);
            const y2 = to.y - (dy / len) * (NODE_HALF_SIZE + 8);
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            return (
              <g key={edge.id}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-muted-foreground" strokeWidth={2} markerEnd="url(#pfd-arrow)" />
                {edge.branchLabel && (
                  <text x={midX} y={midY - 10} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {edge.branchLabel}
                  </text>
                )}
                <g
                  className="cursor-pointer opacity-40 hover:opacity-100"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => removeEdge(edge.id)}
                >
                  <circle cx={midX} cy={midY} r={7} className="fill-card stroke-destructive" strokeWidth={1.5} />
                  <text x={midX} y={midY + 3} textAnchor="middle" className="fill-destructive text-[9px] font-bold">
                    ×
                  </text>
                </g>
              </g>
            );
          })}

          {connectPreview && diagram.nodes[connectPreview.fromId] && (
            <line
              x1={getPos(connectPreview.fromId).x}
              y1={getPos(connectPreview.fromId).y}
              x2={connectPreview.x}
              y2={connectPreview.y}
              className="stroke-primary"
              strokeWidth={2}
              strokeDasharray="5 5"
            />
          )}

          {positions.map(([id]) => {
            const pos = getPos(id);
            const step = stepById.get(id)!;
            const merges = (incomingCount.get(id) ?? 0) >= 2;
            return (
              <g
                key={id}
                className="cursor-grab text-foreground active:cursor-grabbing"
                style={{ touchAction: "none" }}
                onPointerDown={(e) => handleNodePointerDown(e, id, diagram.nodes[id]!)}
                onPointerMove={handleNodePointerMove}
                onPointerUp={handleNodePointerUp}
                onPointerCancel={handleNodePointerUp}
              >
                <DiagramNodeShape stepType={step.stepType} cx={pos.x} cy={pos.y} fill="transparent" stroke="currentColor" />
                {merges && <circle cx={pos.x} cy={pos.y - NODE_HALF_SIZE} r={4} className="fill-primary" />}
                <text x={pos.x} y={pos.y - 6} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
                  {step.opNo || "—"}
                </text>
                <text x={pos.x} y={pos.y + 10} textAnchor="middle" className="fill-muted-foreground text-[9px]">
                  {step.stepType ?? ""}
                </text>
                <text x={pos.x} y={pos.y + NODE_HALF_SIZE + 16} textAnchor="middle" className="fill-foreground text-[11px]">
                  {truncate(String(step.processDescription ?? ""), 22)}
                </text>

                {HANDLE_OFFSETS.map((offset, i) => (
                  <circle
                    key={i}
                    cx={pos.x + offset.x}
                    cy={pos.y + offset.y}
                    r={5}
                    className="fill-primary/30 stroke-primary hover:fill-primary/70"
                    style={{ touchAction: "none", cursor: "crosshair" }}
                    strokeWidth={1.5}
                    onPointerDown={(e) => handleHandlePointerDown(e, id)}
                    onPointerMove={handleHandlePointerMove}
                    onPointerUp={handleHandlePointerUp}
                    onPointerCancel={() => {
                      connectState.current = null;
                      setConnectPreview(null);
                    }}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

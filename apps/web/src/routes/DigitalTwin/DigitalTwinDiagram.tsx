import type { TwinNode } from "../../api/types";

interface DigitalTwinDiagramProps {
  nodes: TwinNode[];
  edges: { from: string; to: string }[];
  riskHeatmap?: { nodeId: string; riskScore: number }[];
  bottleneck?: { nodeId: string; utilizationPct: number } | null;
}

/**
 * Full-System Audit finding (Digital Twin, cheap version): the page had real
 * simulation math (predicted defect rate, bottleneck, per-node risk) but
 * rendered it as plain text with no diagram at all. This draws the model's
 * own real graph — nothing fabricated, every color/ring comes from data the
 * page already fetches.
 *
 * Same 4-tier thresholds as DigitalTwinPage.tsx's own heatColor (exported
 * from here so both use the one definition, not two that could drift).
 */
export function heatColor(riskScore: number): string {
  if (riskScore > 10) return "#e11d48";
  if (riskScore > 5) return "#fb923c";
  if (riskScore > 1) return "#f59e0b";
  return "#64748b";
}

/**
 * Left-to-right auto-layout, ordered by the same real topological order the
 * backend's simulation-engine.ts's own `topologicalOrder` (Kahn's algorithm)
 * computes for defect propagation — so the diagram's left-to-right reading
 * order matches the order the simulation actually walked, not an arbitrary
 * array order. Same "forgiving" cycle handling: an edge referencing a
 * missing node id is ignored, and any node a cycle prevents from being
 * ordered is appended in the model's own original order rather than thrown.
 */
function topologicalOrder(nodes: TwinNode[], edges: { from: string; to: string }[]): TwinNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));

  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue = nodes.filter((n) => inDegree.get(n.id) === 0);
  const remaining = new Map(inDegree);
  const order: TwinNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const nextId of outgoing.get(node.id) ?? []) {
      const next = (remaining.get(nextId) ?? 1) - 1;
      remaining.set(nextId, next);
      if (next === 0) {
        const nextNode = byId.get(nextId);
        if (nextNode) queue.push(nextNode);
      }
    }
  }

  if (order.length < nodes.length) {
    const seen = new Set(order.map((n) => n.id));
    for (const node of nodes) if (!seen.has(node.id)) order.push(node);
  }

  return order;
}

const NODE_RADIUS = 44;
const NODE_SPACING = 200;
const ROW_Y = 100;
const SVG_HEIGHT = 200;

export function DigitalTwinDiagram({ nodes, edges, riskHeatmap = [], bottleneck }: DigitalTwinDiagramProps) {
  if (nodes.length === 0) return null;

  const order = topologicalOrder(nodes, edges);
  const positionOf = new Map(order.map((n, i) => [n.id, { x: NODE_RADIUS + 24 + i * NODE_SPACING, y: ROW_Y }]));
  const riskById = new Map(riskHeatmap.map((r) => [r.nodeId, r.riskScore]));
  const width = Math.max(400, NODE_RADIUS * 2 + 48 + (order.length - 1) * NODE_SPACING);

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-background/50 p-2">
      <svg viewBox={`0 0 ${width} ${SVG_HEIGHT}`} width={width} height={SVG_HEIGHT}>
        <defs>
          <marker id="twin-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" className="fill-muted-foreground" />
          </marker>
        </defs>

        {edges.map((edge, i) => {
          const from = positionOf.get(edge.from);
          const to = positionOf.get(edge.to);
          if (!from || !to) return null;
          const dx = to.x - from.x || 1;
          const dy = to.y - from.y;
          const len = Math.hypot(dx, dy);
          const x1 = from.x + (dx / len) * NODE_RADIUS;
          const y1 = from.y + (dy / len) * NODE_RADIUS;
          const x2 = to.x - (dx / len) * (NODE_RADIUS + 8);
          const y2 = to.y - (dy / len) * (NODE_RADIUS + 8);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-muted-foreground" strokeWidth={2} markerEnd="url(#twin-arrow)" />;
        })}

        {order.map((node) => {
          const pos = positionOf.get(node.id)!;
          const risk = riskById.get(node.id);
          const isBottleneck = bottleneck?.nodeId === node.id;
          const fill = risk === undefined ? "transparent" : heatColor(risk);
          return (
            <g key={node.id}>
              <circle cx={pos.x} cy={pos.y} r={NODE_RADIUS} fill={fill} fillOpacity={risk === undefined ? 0 : 0.22} stroke={fill === "transparent" ? "currentColor" : fill} strokeWidth={2} className={fill === "transparent" ? "text-border" : undefined} />
              {isBottleneck && <circle cx={pos.x} cy={pos.y} r={NODE_RADIUS + 8} fill="none" className="stroke-primary" strokeWidth={2} strokeDasharray="4 4" />}
              <text x={pos.x} y={pos.y - 4} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
                {node.name}
              </text>
              <text x={pos.x} y={pos.y + 12} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {risk !== undefined ? `${risk}% risk` : node.type}
              </text>
              {isBottleneck && (
                <text x={pos.x} y={pos.y + NODE_RADIUS + 24} textAnchor="middle" className="fill-primary text-[10px] font-medium">
                  bottleneck — {bottleneck!.utilizationPct}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

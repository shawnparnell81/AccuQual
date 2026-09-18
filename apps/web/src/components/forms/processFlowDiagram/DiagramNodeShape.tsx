/** ASME-style process-chart symbols, one per `stepType` (see processFlowDiagram.ts's 8-value select). */
export const NODE_HALF_SIZE = 44;

interface DiagramNodeShapeProps {
  stepType: string | undefined;
  cx: number;
  cy: number;
  fill: string;
  stroke: string;
}

const R = NODE_HALF_SIZE;

export function DiagramNodeShape({ stepType, cx, cy, fill, stroke }: DiagramNodeShapeProps) {
  // pointerEvents: "fill" — a `fill="transparent"` shape's interior counts as
  // unpainted under the SVG default (`visiblePainted`), so a click anywhere
  // inside the shape but not exactly on its stroke line would otherwise miss
  // it entirely and never reach the drag handler on the parent <g>.
  const common = { fill, stroke, strokeWidth: 2.5, style: { pointerEvents: "fill" as const } };

  switch (stepType) {
    case "Inspection":
      return <rect x={cx - R} y={cy - R} width={2 * R} height={2 * R} {...common} />;
    case "Op / Insp":
      return (
        <>
          <circle cx={cx} cy={cy} r={R} {...common} />
          <rect x={cx - R * 0.55} y={cy - R * 0.55} width={R * 1.1} height={R * 1.1} fill={fill} stroke={stroke} strokeWidth={2} style={{ pointerEvents: "fill" }} />
        </>
      );
    case "Transport":
      return <path d={`M${cx - R * 0.75},${cy - R} L${cx + R},${cy} L${cx - R * 0.75},${cy + R} Z`} {...common} />;
    case "Delay":
      return (
        <path
          d={`M${cx - R},${cy - R} L${cx},${cy - R} A${R},${R} 0 0 1 ${cx},${cy + R} L${cx - R},${cy + R} Z`}
          {...common}
        />
      );
    case "Storage":
      return <path d={`M${cx - R},${cy - R} L${cx + R},${cy - R} L${cx},${cy + R} Z`} {...common} />;
    case "Decision":
      return <path d={`M${cx},${cy - R} L${cx + R},${cy} L${cx},${cy + R} L${cx - R},${cy} Z`} {...common} />;
    case "Other":
      return <rect x={cx - R} y={cy - R} width={2 * R} height={2 * R} rx={10} {...common} />;
    case "Operation":
    default:
      return <circle cx={cx} cy={cy} r={R} {...common} />;
  }
}

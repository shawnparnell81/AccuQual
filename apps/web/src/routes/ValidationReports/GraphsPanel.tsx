import { useMemo, useState } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { GraphSpec } from "../../lib/validation-forms/formModule";
import { MAX_GRAPH_POINTS, downsample, parsePoints, pointsToText, type GraphData, type GraphPoint } from "../../lib/validation-forms/graph";

/** Rows of the point table shown at a time, so a 50,000-point run stays quick. */
const PAGE_ROWS = 100;

interface Props {
  spec: GraphSpec;
  graph: GraphData;
  readOnly: boolean;
  onChange: (next: GraphData) => void;
}

/**
 * The workbook's Graphs tab: the CTW run's header fields, an editable and pasteable Displacement/Force table, and the
 * scatter chart. The chart and header fields print with the report; the table and paste box do not.
 */
export function GraphsPanel({ spec, graph, readOnly, onChange }: Props) {
  const [pasteText, setPasteText] = useState("");
  const [note, setNote] = useState("");
  const [page, setPage] = useState(0);
  const drawn = useMemo(() => downsample(graph.points).map(([x, y]) => ({ x, y })), [graph.points]);
  const pages = Math.max(1, Math.ceil(graph.points.length / PAGE_ROWS));
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_ROWS;
  const visible = graph.points.slice(start, start + PAGE_ROWS);

  function setField(name: string, value: string) {
    onChange({ ...graph, fields: { ...graph.fields, [name]: value } });
  }

  function setPoint(index: number, axis: 0 | 1, text: string) {
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) return;
    const points = graph.points.map((point, at): GraphPoint => (at === index ? (axis === 0 ? [value, point[1]] : [point[0], value]) : point));
    onChange({ ...graph, points });
  }

  function applyPaste(replace: boolean) {
    const parsed = parsePoints(pasteText);
    if (parsed.points.length === 0) {
      setNote("No points found. Paste two columns of numbers: displacement, then force.");
      return;
    }
    const room = MAX_GRAPH_POINTS - (replace ? 0 : graph.points.length);
    const added = parsed.points.slice(0, Math.max(0, room));
    onChange({ ...graph, points: replace ? added : [...graph.points, ...added] });
    const parts = [`${added.length} points ${replace ? "set" : "added"}`];
    if (parsed.skipped > 0) parts.push(`${parsed.skipped} lines skipped (headers or blanks)`);
    if (parsed.truncated || added.length < parsed.points.length) parts.push(`limit is ${MAX_GRAPH_POINTS.toLocaleString("en-US")} points`);
    setNote(`${parts.join(". ")}.`);
    setPasteText("");
    setPage(0);
  }

  return (
    <section className="vf-figure mt-4 flex flex-col gap-3" data-testid="graphs-panel" aria-label={spec.title}>
      <h3 className="text-base font-semibold">{spec.title}</h3>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        {spec.fields.map((name) => (
          <div key={name} className="flex flex-col gap-0.5 text-sm">
            <dt className="text-xs font-medium text-muted-foreground">{name}</dt>
            <dd>
              {readOnly ? (
                <span>{graph.fields[name] || "—"}</span>
              ) : (
                <input className="w-full rounded-md border border-border bg-background px-2 py-1" aria-label={name} value={graph.fields[name] ?? ""} onChange={(event) => setField(name, event.target.value)} />
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div style={{ width: "100%", height: 340, background: "#fff" }} data-testid="graph-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 24, bottom: 28, left: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#bbb" />
            <XAxis type="number" dataKey="x" name={spec.xLabel} domain={["auto", "auto"]} stroke="#000" tick={{ fill: "#000", fontSize: 11 }} label={{ value: spec.xLabel, position: "insideBottom", offset: -16, fill: "#000", fontSize: 12 }} />
            <YAxis type="number" dataKey="y" name={spec.yLabel} domain={["auto", "auto"]} stroke="#000" tick={{ fill: "#000", fontSize: 11 }} label={{ value: spec.yLabel, angle: -90, position: "insideLeft", fill: "#000", fontSize: 12 }} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={drawn} fill="#1f5fbf" isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {graph.points.length === 0 && <p className="text-xs text-muted-foreground">No points yet. {readOnly ? "" : "Paste the run's displacement and force below."}</p>}
      <div className="no-print flex flex-col gap-2">
        {!readOnly && (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Paste points (two columns: displacement, force)</span>
              <textarea className="min-h-[72px] rounded-md border border-border bg-background p-2 font-mono text-xs" aria-label="Paste points" value={pasteText} onChange={(event) => setPasteText(event.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-md border border-border px-2 py-1 text-sm" disabled={!pasteText.trim()} onClick={() => applyPaste(true)}>
                Replace points
              </button>
              <button type="button" className="rounded-md border border-border px-2 py-1 text-sm" disabled={!pasteText.trim()} onClick={() => applyPaste(false)}>
                Add to points
              </button>
              <button type="button" className="rounded-md border border-border px-2 py-1 text-sm" disabled={graph.points.length === 0} onClick={() => onChange({ ...graph, points: [] })}>
                Clear points
              </button>
              <button type="button" className="rounded-md border border-border px-2 py-1 text-sm" disabled={graph.points.length >= MAX_GRAPH_POINTS} onClick={() => onChange({ ...graph, points: [...graph.points, [0, 0]] })}>
                Add row
              </button>
            </div>
            {note && <p className="text-xs text-muted-foreground" role="status">{note}</p>}
          </div>
        )}
        {graph.points.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              {graph.points.length.toLocaleString("en-US")} points
              {graph.points.length > drawn.length ? `; the chart shows ${drawn.length.toLocaleString("en-US")} of them` : ""}.
            </p>
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-muted text-xs">
                  <tr>
                    <th className="px-2 py-1 font-medium">#</th>
                    <th className="px-2 py-1 font-medium">{spec.xLabel}</th>
                    <th className="px-2 py-1 font-medium">{spec.yLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((point, offset) => {
                    const index = start + offset;
                    return (
                      <tr key={index} className="border-t border-border">
                        <td className="px-2 py-0.5 text-muted-foreground">{index + 1}</td>
                        {([0, 1] as const).map((axis) => (
                          <td key={axis} className="px-2 py-0.5">
                            {readOnly ? (
                              point[axis]
                            ) : (
                              <input
                                key={`${index}-${axis}-${point[axis]}`}
                                className="w-28 rounded border border-border bg-background px-1"
                                aria-label={`${axis === 0 ? spec.xLabel : spec.yLabel} ${index + 1}`}
                                defaultValue={point[axis]}
                                onBlur={(event) => setPoint(index, axis, event.target.value)}
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <button type="button" className="rounded-md border border-border px-2 py-0.5" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  Previous
                </button>
                <span>
                  Rows {start + 1}–{Math.min(start + PAGE_ROWS, graph.points.length)} of {graph.points.length.toLocaleString("en-US")}
                </span>
                <button type="button" className="rounded-md border border-border px-2 py-0.5" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                  Next
                </button>
                <button type="button" className="rounded-md border border-border px-2 py-0.5" onClick={() => void navigator.clipboard?.writeText(pointsToText(graph.points))}>
                  Copy all
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

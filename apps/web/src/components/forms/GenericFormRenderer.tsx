import { useEffect } from "react";
import type { Block, FormLayout, RowBlock, TableBlock, TextareaBlock, YesNoBlock } from "./layouts/types";
import { materializeRow, STATUS_COLORS } from "./formulas";
import { DetailsDisclosure } from "./DetailsDisclosure";

// NAVY (header bars) is matched to the reference templates and kept in sync
// with schema-pdf-renderer.ts's own constant so the on-screen form and the
// exported PDF look like the same document — dark navy + white text reads
// fine against either theme, so unlike the label/border colors below it
// doesn't need a theme-aware token. Label cells and borders use the app's
// own `bg-muted`/`border-border`/`text-foreground` tokens instead of a
// hardcoded hex: those used to be pale-blue-on-dark-text unconditionally,
// which read as a jarring light patch once dark mode shipped.
const NAVY = "#1d3a5c";

interface GenericFormRendererProps {
  layout: FormLayout;
  data: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  /**
   * Renders every block's value as static styled text instead of an
   * input/textarea/select — same wrapper markup/classes as the editable
   * version, so a read-only pane fed the same layout+data stays visually
   * identical to the editable one beside it. Used by the NCR workspace's
   * live preview pane (see NcrWorkspacePage.tsx) — a local re-render of
   * in-memory state, not a PDF export round trip.
   */
  readOnly?: boolean;
  /**
   * Section numbers parked behind "Add details" (root cause, closure,
   * document-control metadata). Omitted sections stay in front. The
   * read-only preview omits this so the full document still shows.
   */
  detailSectionNumbers?: string[];
}

function SectionCard({
  section,
  data,
  onChange,
  readOnly,
}: {
  section: FormLayout["sections"][number];
  data: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  readOnly: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: NAVY }}>
        {section.number}. {section.title}
      </div>
      <div className="flex flex-col divide-y divide-border">
        {section.blocks.map((block, i) => (
          <BlockView key={i} block={block} data={data} onChange={onChange} readOnly={readOnly} />
        ))}
      </div>
    </div>
  );
}

export function GenericFormRenderer({ layout, data, onChange, readOnly = false, detailSectionNumbers }: GenericFormRendererProps) {
  const parked = new Set(detailSectionNumbers ?? []);
  const primary = layout.sections.filter((section) => !parked.has(section.number));
  const details = layout.sections.filter((section) => parked.has(section.number));
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-center text-base font-bold uppercase tracking-wide" style={{ color: NAVY }}>
        {layout.title}
      </h2>
      {primary.map((section) => (
        <SectionCard key={section.number} section={section} data={data} onChange={onChange} readOnly={readOnly} />
      ))}
      {details.length > 0 && (
        <DetailsDisclosure label="Add details — cause, fix, and closure">
          {details.map((section) => (
            <SectionCard key={section.number} section={section} data={data} onChange={onChange} readOnly={readOnly} />
          ))}
        </DetailsDisclosure>
      )}
    </div>
  );
}

interface BlockViewProps<B> {
  block: B;
  data: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  readOnly: boolean;
}

function BlockView({ block, data, onChange, readOnly }: BlockViewProps<Block>) {
  switch (block.type) {
    case "row":
      return <RowBlockView block={block} data={data} onChange={onChange} readOnly={readOnly} />;
    case "textarea":
      return <TextareaBlockView block={block} data={data} onChange={onChange} readOnly={readOnly} />;
    case "yesno":
      return <YesNoBlockView block={block} data={data} onChange={onChange} readOnly={readOnly} />;
    case "table":
      return <TableBlockView block={block} data={data} onChange={onChange} readOnly={readOnly} />;
  }
}

/** Read-only stand-in for an input/select/textarea — same text size/color as the real value, so the two panes line up. */
function StaticValue({ value }: { value: unknown }) {
  const text = value === undefined || value === null || value === "" ? "" : String(value);
  return <p className="min-h-[1.25em] whitespace-pre-wrap text-xs text-foreground">{text || " "}</p>;
}

function RowBlockView({ block, data, onChange, readOnly }: BlockViewProps<RowBlock>) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${block.fields.length}, minmax(0, 1fr))` }}>
      {block.fields.map((field) => (
        <div key={field.name} className="grid grid-cols-[2fr_3fr] border-t border-border first:border-t-0">
          <div className="bg-muted px-2 py-1.5">
            <p className="text-[11px] font-semibold text-foreground">{field.label}</p>
            {field.hint && <p className="text-[9px] italic text-muted-foreground">{field.hint}</p>}
          </div>
          <div className="px-2 py-1">
            {readOnly || field.readOnly ? (
              <StaticValue value={data[field.name]} />
            ) : field.kind === "select" ? (
              <select
                className="w-full bg-transparent text-xs outline-none"
                value={(data[field.name] as string) ?? ""}
                onChange={(e) => onChange(field.name, e.target.value)}
              >
                <option value="" />
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"}
                className="w-full bg-transparent text-xs outline-none"
                value={(data[field.name] as string) ?? ""}
                onChange={(e) => onChange(field.name, field.kind === "number" ? e.target.valueAsNumber : e.target.value)}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function TextareaBlockView({ block, data, onChange, readOnly }: BlockViewProps<TextareaBlock>) {
  return (
    <div>
      <div className="bg-muted px-2 py-1.5">
        <p className="text-[11px] font-semibold text-foreground">{block.label}</p>
        {block.hint && <p className="text-[9px] italic text-muted-foreground">{block.hint}</p>}
      </div>
      {readOnly ? (
        <div className="px-2 py-2">
          <StaticValue value={data[block.name]} />
        </div>
      ) : (
        <textarea
          className="w-full resize-y bg-transparent px-2 py-2 text-xs outline-none"
          rows={4}
          value={(data[block.name] as string) ?? ""}
          onChange={(e) => onChange(block.name, e.target.value)}
        />
      )}
    </div>
  );
}

function YesNoBlockView({ block, data, onChange, readOnly }: BlockViewProps<YesNoBlock>) {
  const value = (data[block.name] as string) ?? "";
  return (
    <div className="flex items-center justify-between bg-muted px-2 py-2">
      <p className="text-[11px] font-semibold text-foreground">{block.label}</p>
      <div className="flex items-center gap-3 text-xs">
        {(["yes", "no"] as const).map((opt) =>
          readOnly ? (
            <span key={opt} className={value === opt ? "font-semibold text-foreground" : "text-muted-foreground"}>
              {value === opt ? "● " : "○ "}
              {opt.toUpperCase()}
            </span>
          ) : (
            <label key={opt} className="flex items-center gap-1">
              <input type="radio" name={block.name} checked={value === opt} onChange={() => onChange(block.name, opt)} />
              {opt.toUpperCase()}
            </label>
          ),
        )}
      </div>
    </div>
  );
}

function TableBlockView({ block, data, onChange, readOnly }: BlockViewProps<TableBlock>) {
  const rows: Record<string, unknown>[] =
    (data[block.name] as Record<string, unknown>[] | undefined) ??
    (block.fixedRowLabels ? block.fixedRowLabels.map(() => ({})) : Array.from({ length: block.minRows ?? 1 }, () => ({})));

  const hasComputedColumns = block.columns.some((c) => c.kind === "computed" && c.formula);

  // Refresh computed columns once on mount — covers date-driven formulas (e.g.
  // calibration due-date status) whose answer depends on "today" and can go
  // stale between visits even when no cell was actually edited this session.
  useEffect(() => {
    // The read-only preview pane must never write — it shares the same
    // in-memory data as the editable pane, which already owns this refresh.
    if (!hasComputedColumns || readOnly) return;
    let changed = false;
    const refreshed = rows.map((r) => {
      const next = materializeRow(r, block.columns);
      if (next !== r) changed = true;
      return next;
    });
    if (changed) onChange(block.name, refreshed);
    // Intentionally runs once on mount only — see the comment above.
  }, []);

  function updateCell(rowIndex: number, key: string, value: unknown) {
    const next = rows.map((r, i) => {
      if (i !== rowIndex) return r;
      const updated = { ...r, [key]: value };
      return hasComputedColumns ? materializeRow(updated, block.columns) : updated;
    });
    onChange(block.name, next);
  }

  function addRow() {
    onChange(block.name, [...rows, {}]);
  }

  function removeRow(index: number) {
    onChange(block.name, rows.filter((_, i) => i !== index));
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            {block.fixedRowLabels && (
              <th className="border-t border-border bg-muted px-2 py-1.5 text-left font-semibold text-foreground">
                {block.labelColumnHeader ?? "Role"}
              </th>
            )}
            {block.columns.map((col) => (
              <th key={col.key} className="border-t border-border bg-muted px-2 py-1.5 text-left font-semibold text-foreground">
                {col.label}
              </th>
            ))}
            {block.addableRows && !readOnly && <th className="w-8 border-t border-border bg-muted" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {block.fixedRowLabels && (
                <td className="border-t border-border bg-muted px-2 py-1.5 font-medium text-foreground">
                  {block.fixedRowLabels[rowIndex]}
                </td>
              )}
              {block.columns.map((col) => (
                <td key={col.key} className="border-t border-border px-2 py-1.5 align-top">
                  {col.kind === "checkboxGroup" ? (
                    <div className="flex flex-col gap-1">
                      {col.options?.map((opt) => {
                        const selected = (row[col.key] as Record<string, boolean> | undefined) ?? {};
                        return readOnly ? (
                          <span key={opt} className={selected[opt] ? "font-semibold text-foreground" : "text-muted-foreground"}>
                            {selected[opt] ? "☑ " : "☐ "}
                            {opt}
                          </span>
                        ) : (
                          <label key={opt} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={Boolean(selected[opt])}
                              onChange={(e) => updateCell(rowIndex, col.key, { ...selected, [opt]: e.target.checked })}
                            />
                            {opt}
                          </label>
                        );
                      })}
                    </div>
                  ) : col.kind === "computed" ? (
                    <ComputedCell value={row[col.key]} />
                  ) : readOnly ? (
                    <StaticValue value={row[col.key]} />
                  ) : col.kind === "textarea" ? (
                    <textarea
                      className="w-full resize-y bg-transparent text-xs outline-none"
                      rows={2}
                      value={(row[col.key] as string) ?? ""}
                      onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                    />
                  ) : col.kind === "select" ? (
                    <select
                      className="w-full bg-transparent text-xs outline-none"
                      value={(row[col.key] as string) ?? ""}
                      onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                    >
                      <option value="" />
                      {col.options?.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={col.kind === "date" ? "date" : col.kind === "number" ? "number" : "text"}
                      min={col.min}
                      max={col.max}
                      className="w-full bg-transparent text-xs outline-none"
                      value={(row[col.key] as string | number) ?? ""}
                      onChange={(e) =>
                        updateCell(rowIndex, col.key, col.kind === "number" ? e.target.valueAsNumber : e.target.value)
                      }
                    />
                  )}
                </td>
              ))}
              {block.addableRows && !readOnly && (
                <td className="border-t border-border px-1 text-center">
                  <button onClick={() => removeRow(rowIndex)} className="text-muted-foreground hover:text-destructive" aria-label="Remove row">
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {block.addableRows && !readOnly && (
        <button onClick={addRow} className="mt-2 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
          + Add row
        </button>
      )}
    </div>
  );
}

/** A read-only cell for a computed column — a colored status pill for a known status label, plain bold text otherwise. */
function ComputedCell({ value }: { value: unknown }) {
  if (value === "" || value === undefined || value === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const label = String(value);
  const colors = STATUS_COLORS[label];
  if (colors) {
    return (
      <span
        className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
        style={{ backgroundColor: colors.bg, color: colors.fg }}
      >
        {label}
      </span>
    );
  }
  return <span className="text-xs font-semibold text-foreground">{label}</span>;
}

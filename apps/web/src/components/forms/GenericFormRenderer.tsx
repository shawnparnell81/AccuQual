import { useEffect } from "react";
import type { Block, FormLayout, RowBlock, TableBlock, TextareaBlock, YesNoBlock } from "./layouts/types";
import { materializeRow, STATUS_COLORS } from "./formulas";

// Colors matched to the reference templates (dark navy header bars, pale
// blue-gray field boxes) — kept in sync with schema-pdf-renderer.ts's
// constants so the on-screen form and the exported PDF look like the same
// document, not two different ones.
const NAVY = "#1d3a5c";
const LABEL_BG = "#eef5fb";
const BORDER = "#c9d8e7";

interface GenericFormRendererProps {
  layout: FormLayout;
  data: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}

export function GenericFormRenderer({ layout, data, onChange }: GenericFormRendererProps) {
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-center text-base font-bold uppercase tracking-wide" style={{ color: NAVY }}>
        {layout.title}
      </h2>
      {layout.sections.map((section) => (
        <div key={section.number} className="overflow-hidden rounded-md border" style={{ borderColor: BORDER }}>
          <div className="px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: NAVY }}>
            {section.number}. {section.title}
          </div>
          <div className="flex flex-col divide-y" style={{ borderColor: BORDER }}>
            {section.blocks.map((block, i) => (
              <BlockView key={i} block={block} data={data} onChange={onChange} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BlockView({ block, data, onChange }: { block: Block; data: Record<string, unknown>; onChange: (name: string, value: unknown) => void }) {
  switch (block.type) {
    case "row":
      return <RowBlockView block={block} data={data} onChange={onChange} />;
    case "textarea":
      return <TextareaBlockView block={block} data={data} onChange={onChange} />;
    case "yesno":
      return <YesNoBlockView block={block} data={data} onChange={onChange} />;
    case "table":
      return <TableBlockView block={block} data={data} onChange={onChange} />;
  }
}

function RowBlockView({ block, data, onChange }: { block: RowBlock; data: Record<string, unknown>; onChange: (name: string, value: unknown) => void }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${block.fields.length}, minmax(0, 1fr))` }}>
      {block.fields.map((field) => (
        <div key={field.name} className="grid grid-cols-[2fr_3fr] border-t first:border-t-0" style={{ borderColor: BORDER }}>
          <div className="px-2 py-1.5" style={{ backgroundColor: LABEL_BG }}>
            <p className="text-[11px] font-semibold text-slate-800">{field.label}</p>
            {field.hint && <p className="text-[9px] italic text-slate-500">{field.hint}</p>}
          </div>
          <div className="px-2 py-1">
            {field.kind === "select" ? (
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

function TextareaBlockView({ block, data, onChange }: { block: TextareaBlock; data: Record<string, unknown>; onChange: (name: string, value: unknown) => void }) {
  return (
    <div>
      <div className="px-2 py-1.5" style={{ backgroundColor: LABEL_BG }}>
        <p className="text-[11px] font-semibold text-slate-800">{block.label}</p>
        {block.hint && <p className="text-[9px] italic text-slate-500">{block.hint}</p>}
      </div>
      <textarea
        className="w-full resize-y bg-transparent px-2 py-2 text-xs outline-none"
        rows={4}
        value={(data[block.name] as string) ?? ""}
        onChange={(e) => onChange(block.name, e.target.value)}
      />
    </div>
  );
}

function YesNoBlockView({ block, data, onChange }: { block: YesNoBlock; data: Record<string, unknown>; onChange: (name: string, value: unknown) => void }) {
  const value = (data[block.name] as string) ?? "";
  return (
    <div className="flex items-center justify-between px-2 py-2" style={{ backgroundColor: LABEL_BG }}>
      <p className="text-[11px] font-semibold text-slate-800">{block.label}</p>
      <div className="flex items-center gap-3 text-xs">
        {(["yes", "no"] as const).map((opt) => (
          <label key={opt} className="flex items-center gap-1">
            <input type="radio" name={block.name} checked={value === opt} onChange={() => onChange(block.name, opt)} />
            {opt.toUpperCase()}
          </label>
        ))}
      </div>
    </div>
  );
}

function TableBlockView({ block, data, onChange }: { block: TableBlock; data: Record<string, unknown>; onChange: (name: string, value: unknown) => void }) {
  const rows: Record<string, unknown>[] =
    (data[block.name] as Record<string, unknown>[] | undefined) ??
    (block.fixedRowLabels ? block.fixedRowLabels.map(() => ({})) : Array.from({ length: block.minRows ?? 1 }, () => ({})));

  const hasComputedColumns = block.columns.some((c) => c.kind === "computed" && c.formula);

  // Refresh computed columns once on mount — covers date-driven formulas (e.g.
  // calibration due-date status) whose answer depends on "today" and can go
  // stale between visits even when no cell was actually edited this session.
  useEffect(() => {
    if (!hasComputedColumns) return;
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
              <th className="border-t px-2 py-1.5 text-left font-semibold" style={{ backgroundColor: LABEL_BG, borderColor: BORDER }}>
                {block.labelColumnHeader ?? "Role"}
              </th>
            )}
            {block.columns.map((col) => (
              <th key={col.key} className="border-t px-2 py-1.5 text-left font-semibold" style={{ backgroundColor: LABEL_BG, borderColor: BORDER }}>
                {col.label}
              </th>
            ))}
            {block.addableRows && <th className="border-t w-8" style={{ backgroundColor: LABEL_BG, borderColor: BORDER }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {block.fixedRowLabels && (
                <td className="border-t px-2 py-1.5 font-medium" style={{ backgroundColor: LABEL_BG, borderColor: BORDER }}>
                  {block.fixedRowLabels[rowIndex]}
                </td>
              )}
              {block.columns.map((col) => (
                <td key={col.key} className="border-t px-2 py-1.5 align-top" style={{ borderColor: BORDER }}>
                  {col.kind === "checkboxGroup" ? (
                    <div className="flex flex-col gap-1">
                      {col.options?.map((opt) => {
                        const selected = (row[col.key] as Record<string, boolean> | undefined) ?? {};
                        return (
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
                  ) : col.kind === "textarea" ? (
                    <textarea
                      className="w-full resize-y bg-transparent text-xs outline-none"
                      rows={2}
                      value={(row[col.key] as string) ?? ""}
                      onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                    />
                  ) : col.kind === "computed" ? (
                    <ComputedCell value={row[col.key]} />
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
              {block.addableRows && (
                <td className="border-t px-1 text-center" style={{ borderColor: BORDER }}>
                  <button onClick={() => removeRow(rowIndex)} className="text-muted-foreground hover:text-destructive" aria-label="Remove row">
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {block.addableRows && (
        <button onClick={addRow} className="mt-2 rounded-md border px-2 py-1 text-xs hover:bg-muted" style={{ borderColor: BORDER }}>
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
  return <span className="text-xs font-semibold text-slate-800">{label}</span>;
}

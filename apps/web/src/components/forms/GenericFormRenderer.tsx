import { useEffect } from "react";
import type { Block, FormLayout, RowBlock, TableBlock, TextareaBlock, YesNoBlock } from "./layouts/types";
import { passFailPaint } from "../../lib/passFail";
import { materializeRow, STATUS_COLORS } from "./formulas";
import { FMEA_TONE_CLASS, FMEA_TONE_NAME, fmeaCellValue, fmeaComputedTone } from "./fmeaPriority";
import { DetailsDisclosure } from "./DetailsDisclosure";
import { inputTypeForFieldKind } from "./formInputType";
import { formAllowsInlinePictures } from "./inlinePictures";
import { PictureText } from "./PictureText";
import { usePictureRecord } from "./pictureRecord";
import { DEFAULT_CERTIFY, SIGNATURE_DATE_FIELD, SignatureStamp } from "./SignatureStamp";
import { useFormSign } from "./formSign";
import { FormHeader } from "../brand/DmaLogo";

// Section bars and the document title use tokens whose Classic values are
// the same navy as schema-pdf-renderer.ts (#1d3a5c), so the on-screen form
// and the exported PDF still match in AccuQual Classic. A color scheme can
// retint the on-screen form through --form-bar / --form-heading without
// changing the PDF. Label cells and input wells use the shared form tokens.
const FORM_BAR = "var(--form-bar, #1d3a5c)";
const FORM_BAR_TEXT = "var(--form-bar-foreground, #fff)";
const labelCell = "bg-[hsl(var(--form-label))] text-[hsl(var(--form-label-foreground))]";
const valueCell = "bg-[hsl(var(--form-input))] text-[hsl(var(--form-input-foreground))]";

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
  pictures,
}: {
  section: FormLayout["sections"][number];
  data: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  readOnly: boolean;
  pictures: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: FORM_BAR, color: FORM_BAR_TEXT }}>
        {section.number}. {section.title}
      </div>
      <div className="flex flex-col divide-y divide-border">
        {section.blocks.map((block, i) => (
          <BlockView key={i} block={block} data={data} onChange={onChange} readOnly={readOnly} pictures={pictures} />
        ))}
      </div>
    </div>
  );
}

export function GenericFormRenderer({ layout, data, onChange, readOnly = false, detailSectionNumbers }: GenericFormRendererProps) {
  const parked = new Set(detailSectionNumbers ?? []);
  const primary = layout.sections.filter((section) => !parked.has(section.number));
  const details = layout.sections.filter((section) => parked.has(section.number));
  const pictures = formAllowsInlinePictures(layout.formType);
  return (
    <div className={`flex flex-col gap-5${readOnly ? " aq-form-copy min-w-0" : ""}`}>
      <FormHeader title={layout.title} />
      {primary.map((section) => (
        <SectionCard key={section.number} section={section} data={data} onChange={onChange} readOnly={readOnly} pictures={pictures} />
      ))}
      {details.length > 0 && (
        <DetailsDisclosure label="Add details — cause, fix, and closure">
          {details.map((section) => (
            <SectionCard key={section.number} section={section} data={data} onChange={onChange} readOnly={readOnly} pictures={pictures} />
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
  pictures: boolean;
}

function BlockView({ block, data, onChange, readOnly, pictures }: BlockViewProps<Block>) {
  switch (block.type) {
    case "row":
      return <RowBlockView block={block} data={data} onChange={onChange} readOnly={readOnly} pictures={pictures} />;
    case "textarea":
      return <TextareaBlockView block={block} data={data} onChange={onChange} readOnly={readOnly} pictures={pictures} />;
    case "yesno":
      return <YesNoBlockView block={block} data={data} onChange={onChange} readOnly={readOnly} pictures={pictures} />;
    case "table":
      return <TableBlockView block={block} data={data} onChange={onChange} readOnly={readOnly} pictures={pictures} />;
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
          <div className={`${labelCell} px-2 py-1.5`}>
            <p className="text-[11px] font-semibold">{field.label}</p>
            {field.hint && <p className="text-[9px] italic text-muted-foreground">{field.hint}</p>}
          </div>
          <div className={`${valueCell} px-2 py-1`}>
            {field.kind === "signature" ? (
              <SignatureField
                value={data[field.name]}
                path={field.name}
                certify={field.certify}
                readOnly={readOnly || Boolean(field.readOnly)}
                dateEmpty={(() => {
                  const sibling = SIGNATURE_DATE_FIELD[field.name];
                  return !sibling || data[sibling] == null || data[sibling] === "";
                })()}
                onStamp={(stamp, signedOn) => {
                  onChange(field.name, stamp);
                  const sibling = SIGNATURE_DATE_FIELD[field.name];
                  if (sibling && signedOn) onChange(sibling, signedOn);
                }}
              />
            ) : readOnly || field.readOnly ? (
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
                type={inputTypeForFieldKind(field.kind)}
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

function TextareaBlockView({ block, data, onChange, readOnly, pictures }: BlockViewProps<TextareaBlock>) {
  const record = usePictureRecord();
  const picture = pictures ? record : null;
  return (
    <div>
      <div className={`${labelCell} px-2 py-1.5`}>
        <p className="text-[11px] font-semibold">{block.label}</p>
        {block.hint && <p className="text-[9px] italic text-muted-foreground">{block.hint}</p>}
      </div>
      {pictures ? (
        <PictureText
          className={`w-full px-2 py-2 text-xs outline-none ${valueCell}`}
          rows={4}
          value={String(data[block.name] ?? "")}
          readOnly={readOnly}
          ariaLabel={block.label}
          allowInsert={pictures}
          entityType={picture?.entityType}
          entityId={picture?.entityId}
          onChange={(value) => onChange(block.name, value)}
        />
      ) : readOnly ? (
        <div className={`px-2 py-2 ${valueCell}`}>
          <StaticValue value={data[block.name]} />
        </div>
      ) : (
        <textarea
          rows={4}
          aria-label={block.label}
          className={`w-full resize-y px-2 py-2 text-xs outline-none ${valueCell}`}
          value={String(data[block.name] ?? "")}
          onChange={(event) => onChange(block.name, event.target.value)}
        />
      )}
    </div>
  );
}

function YesNoBlockView({ block, data, onChange, readOnly }: BlockViewProps<YesNoBlock>) {
  const value = (data[block.name] as string) ?? "";
  return (
    <div className={`flex items-center justify-between px-2 py-2 ${labelCell}`}>
      <p className="text-[11px] font-semibold">{block.label}</p>
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

function TableBlockView({ block, data, onChange, readOnly, pictures }: BlockViewProps<TableBlock>) {
  const record = usePictureRecord();
  const picture = pictures ? record : null;
  const rows: Record<string, unknown>[] =
    (data[block.name] as Record<string, unknown>[] | undefined) ??
    (block.fixedRowLabels ? block.fixedRowLabels.map(() => ({})) : Array.from({ length: block.minRows ?? 1 }, () => ({})));

  const hasComputedColumns = block.columns.some((c) => c.kind === "computed" && c.formula);
  const storedRows = data[block.name];

  // Refresh computed columns when the saved rows arrive and again if that
  // array is replaced. Covers date-driven formulas (calibration due-date
  // status) and FMEA Action Priority on an older saved row that has no AP
  // key yet. A missing array is left alone so placeholder rows for a new
  // form are not written before the saved document has loaded.
  useEffect(() => {
    // The read-only preview pane must never write — it shares the same
    // in-memory data as the editable pane, which already owns this refresh.
    if (!hasComputedColumns || readOnly || !Array.isArray(storedRows)) return;
    let changed = false;
    const refreshed = storedRows.map((r) => {
      const row = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
      const next = materializeRow(row, block.columns);
      if (next !== row) changed = true;
      return next;
    });
    if (changed) onChange(block.name, refreshed);
  }, [storedRows, hasComputedColumns, readOnly]);

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
    <div>
      <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            {block.fixedRowLabels && (
              <th className={`border-t border-border px-2 py-1.5 text-left font-semibold ${labelCell}`}>
                {block.labelColumnHeader ?? "Role"}
              </th>
            )}
            {block.columns.map((col) => (
              <th key={col.key} className={`border-t border-border px-2 py-1.5 text-left font-semibold ${labelCell}`}>
                {col.label}
              </th>
            ))}
            {block.addableRows && !readOnly && <th className={`w-8 border-t border-border ${labelCell}`} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {block.fixedRowLabels && (
                <td className={`border-t border-border px-2 py-1.5 font-medium ${labelCell}`}>
                  {block.fixedRowLabels[rowIndex]}
                </td>
              )}
              {block.columns.map((col) => (
                <td key={col.key} className={`border-t border-border px-2 py-1.5 align-top ${valueCell}`}>
                  {col.kind === "checkboxGroup" ? (
                    <div className="flex flex-col gap-1">
                      {col.options?.map((opt) => {
                        const selected = (row[col.key] as Record<string, boolean> | undefined) ?? {};
                        const beside = col.beside?.option === opt ? col.beside : undefined;
                        const parentOn = Boolean(selected[opt]);
                        function write(next: Record<string, boolean>) {
                          updateCell(rowIndex, col.key, next);
                        }
                        return (
                          <div key={opt} className="flex flex-col gap-1">
                            {readOnly ? (
                              <span className={parentOn ? "font-semibold text-foreground" : "text-muted-foreground"}>
                                {parentOn ? "☑ " : "☐ "}
                                {opt}
                              </span>
                            ) : (
                              <label className="form-check">
                                <input
                                  type="checkbox"
                                  checked={parentOn}
                                  onChange={(e) => {
                                    const next = { ...selected, [opt]: e.target.checked };
                                    if (!e.target.checked && beside) {
                                      for (const choice of beside.choices) next[choice] = false;
                                    }
                                    write(next);
                                  }}
                                />
                                {opt}
                              </label>
                            )}
                            {beside && (
                              <div className="ml-5 flex flex-col gap-1">
                                {beside.choices.map((choice) => {
                                  const on = parentOn && Boolean(selected[choice]);
                                  return readOnly ? (
                                    <span key={choice} className={on ? "font-semibold text-foreground" : parentOn ? "text-muted-foreground" : "text-muted-foreground opacity-50"}>
                                      {on ? "☑ " : "☐ "}
                                      {choice}
                                    </span>
                                  ) : (
                                    <label key={choice} className={`form-check ${parentOn ? "" : "opacity-50"}`}>
                                      <input
                                        type="checkbox"
                                        checked={on}
                                        disabled={!parentOn}
                                        onChange={(e) => {
                                          const next = { ...selected, [choice]: e.target.checked };
                                          for (const other of beside.choices) {
                                            if (other !== choice) next[other] = false;
                                          }
                                          write(next);
                                        }}
                                      />
                                      {choice}
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : col.kind === "signature" ? (
                    <SignatureField
                      value={row[col.key]}
                      path={`${block.name}.${rowIndex}.${col.key}`}
                      certify={col.certify}
                      readOnly={readOnly}
                      dateEmpty={(() => {
                        const sibling = SIGNATURE_DATE_FIELD[col.key];
                        return !sibling || row[sibling] == null || row[sibling] === "";
                      })()}
                      onStamp={(stamp, signedOn) => {
                        const sibling = SIGNATURE_DATE_FIELD[col.key];
                        const next = rows.map((r, i) => {
                          if (i !== rowIndex) return r;
                          const patched = { ...r, [col.key]: stamp };
                          if (sibling && signedOn) patched[sibling] = signedOn;
                          return hasComputedColumns ? materializeRow(patched, block.columns) : patched;
                        });
                        onChange(block.name, next);
                      }}
                    />
                  ) : col.kind === "computed" ? (
                    <ComputedCell value={fmeaCellValue(col.formula, row, row[col.key])} formula={col.formula} />
                  ) : col.kind === "textarea" ? (
                    pictures ? (
                      <PictureText
                        className="w-full bg-transparent text-xs outline-none"
                        rows={2}
                        value={String(row[col.key] ?? "")}
                        readOnly={readOnly}
                        ariaLabel={col.label}
                        allowInsert={pictures}
                        entityType={picture?.entityType}
                        entityId={picture?.entityId}
                        onChange={(value) => updateCell(rowIndex, col.key, value)}
                      />
                    ) : readOnly ? (
                      <StaticValue value={row[col.key]} />
                    ) : (
                      <textarea
                        rows={2}
                        aria-label={col.label}
                        className="w-full resize-y bg-transparent text-xs outline-none"
                        value={String(row[col.key] ?? "")}
                        onChange={(event) => updateCell(rowIndex, col.key, event.target.value)}
                      />
                    )
                  ) : readOnly ? (
                    <StaticValue value={row[col.key]} />
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
                      type={inputTypeForFieldKind(col.kind)}
                      min={col.min}
                      max={col.max}
                      placeholder={col.placeholder}
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
      </div>
      {block.addableRows && !readOnly && (
        <button onClick={addRow} className="mt-2 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
          + Add row
        </button>
      )}
      {block.legend && <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{block.legend}</p>}
    </div>
  );
}

function SignatureField({
  value,
  path,
  certify,
  readOnly,
  dateEmpty,
  onStamp,
}: {
  value: unknown;
  path: string;
  certify?: string;
  readOnly: boolean;
  dateEmpty: boolean;
  onStamp: (stamp: string, signedOn?: string) => void;
}) {
  const sign = useFormSign();
  const text = typeof value === "string" ? value : "";
  const sentence = certify?.trim() || DEFAULT_CERTIFY;
  if (readOnly || text.trim() || !sign) {
    return <StaticValue value={text} />;
  }
  return (
    <SignatureStamp
      value={text}
      certify={sentence}
      onSign={async (pin) => {
        const result = await sign({ path, description: sentence, pin });
        onStamp(result.stamp, dateEmpty ? result.signedOn : undefined);
      }}
    />
  );
}

/** A read-only cell for a computed column — a colored status pill for a known status label, plain bold text otherwise. */
function ComputedCell({ value, formula }: { value: unknown; formula?: string }) {
  if (value === "" || value === undefined || value === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const tone = fmeaComputedTone(formula, value);
  if (tone) {
    return (
      <span
        className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${FMEA_TONE_CLASS[tone]}`}
        title={FMEA_TONE_NAME[tone]}
      >
        {String(value)}
      </span>
    );
  }
  const label = String(value);
  const measured = passFailPaint(label);
  if (measured) {
    return (
      <span className="inline-block whitespace-nowrap rounded-sm px-2 py-0.5 text-center text-xs font-semibold" style={{ backgroundColor: measured.bg, color: measured.fg }}>
        {label}
      </span>
    );
  }
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

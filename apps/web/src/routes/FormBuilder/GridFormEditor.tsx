import { useMemo, useState } from "react";
import { useItemFolderPath } from "../../components/documents/ItemFolderPath";
import { gridLocationInsert, isExactLocationLabel } from "../../lib/folderPath";
import {
  addressOf,
  blankCell,
  cellPaint,
  cellValueProblem,
  clampSize,
  effectiveCellType,
  evaluatedSheet,
  MAX_GRID_COLS,
  MAX_GRID_ROWS,
  MAX_GRID_SHEETS,
  shownCell,
  type FormCell,
  type FormCellType,
  type FormSheet,
  type GridFormStructure,
} from "../../lib/formGrid";
import {
  applyBorders,
  deleteColumns,
  deleteRows,
  formulasReferencing,
  insertColumns,
  insertRows,
  styleFlagOn,
  toggleStyleFlag,
  type BorderLine,
  type BorderTarget,
  type StyleFlag,
} from "../../lib/formGridEdit";
import { formulaProblem } from "../../../../../services/api/src/modules/form-builder/formulaEngine";
import "./formBuilder.css";

interface Selection {
  sheet: number;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

const CELL_TYPE_LABELS: Array<[FormCellType, string]> = [
  ["label", "Label"],
  ["text", "Text"],
  ["number", "Number"],
  ["date", "Date"],
  ["passfail", "Pass / Fail"],
  ["dropdown", "Dropdown"],
  ["signature", "Signature"],
];

const BORDER_TARGETS: Array<[BorderTarget, string]> = [
  ["top", "Top"],
  ["right", "Right"],
  ["bottom", "Bottom"],
  ["left", "Left"],
  ["outside", "Outside"],
  ["all", "All"],
  ["none", "None"],
];

const BORDER_LINES: Array<[BorderLine, string]> = [
  ["thin", "Thin"],
  ["medium", "Medium"],
  ["thick", "Thick"],
  ["dashed", "Dashed"],
  ["double", "Double"],
];

function cloneSheets(sheets: FormSheet[]): FormSheet[] {
  return JSON.parse(JSON.stringify(sheets)) as FormSheet[];
}

function normalize(selection: Selection) {
  return {
    r1: Math.min(selection.r1, selection.r2),
    c1: Math.min(selection.c1, selection.c2),
    r2: Math.max(selection.r1, selection.r2),
    c2: Math.max(selection.c1, selection.c2),
  };
}

const button = "rounded border border-border px-2 py-1";
const pressed = "rounded border border-primary bg-muted px-2 py-1";

export function GridFormEditor({
  structure,
  onChange,
  mode,
  answers,
  onAnswer,
}: {
  structure: GridFormStructure;
  onChange?: (next: GridFormStructure) => void;
  mode: "design" | "fill";
  answers?: Record<string, string>;
  onAnswer?: (key: string, value: string) => void;
}) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const [selection, setSelection] = useState<Selection>({ sheet: 0, r1: 0, c1: 0, r2: 0, c2: 0 });
  const [bar, setBar] = useState("");
  const [note, setNote] = useState("");
  const [borderTarget, setBorderTarget] = useState<BorderTarget>("outside");
  const [borderLine, setBorderLine] = useState<BorderLine>("thin");
  const [borderColor, setBorderColor] = useState("#111111");
  const [optionsText, setOptionsText] = useState("");
  const folderPath = useItemFolderPath();
  const sheet = structure.sheets[sheetIndex] ?? structure.sheets[0];
  const calculated = useMemo(() => (sheet ? evaluatedSheet(sheet, answers, String(sheetIndex)) : {}), [sheet, answers, sheetIndex]);
  if (!sheet) return null;
  const wide = sheet.colWidths.reduce((sum, width) => sum + width, 0) > 760;

  function commitSheets(next: FormSheet[]) {
    onChange?.({ kind: "grid", sheets: next });
  }

  function commitSheet(next: FormSheet) {
    const all = cloneSheets(structure.sheets);
    all[sheetIndex] = next;
    commitSheets(all);
  }

  function updateEach(change: (cell: FormCell) => FormCell) {
    const next = cloneSheets(structure.sheets);
    const current = next[sheetIndex];
    if (!current) return;
    const area = normalize(selection);
    for (let row = area.r1; row <= area.r2; row += 1) {
      for (let col = area.c1; col <= area.c2; col += 1) {
        const cell = current.cells[row]?.[col];
        if (!cell) continue;
        current.cells[row]![col] = change(cell);
      }
    }
    commitSheets(next);
  }

  function updateSelected(patch: Partial<FormCell>) {
    updateEach((cell) => ({ ...cell, ...patch, style: patch.style ? { ...cell.style, ...patch.style } : cell.style }));
  }

  const applyBar = () => {
    const cell = sheet.cells[selection.r1]?.[selection.c1];
    if (!cell || mode !== "design") return;
    const text = bar.trim();
    if (text.startsWith("=")) updateSelected({ formula: text.slice(1), value: "" });
    else updateSelected({ formula: undefined, value: bar });
  };

  const showCell = (row: number, col: number) => {
    const cell = sheet.cells[row]?.[col];
    setBar(cell?.formula ? `=${cell.formula}` : (cell?.value ?? ""));
    setOptionsText(cell?.options?.join("\n") ?? "");
  };

  const select = (row: number, col: number, extend: boolean) => {
    const next = extend ? { ...selection, sheet: sheetIndex, r2: row, c2: col } : { sheet: sheetIndex, r1: row, c1: col, r2: row, c2: col };
    setSelection(next);
    showCell(row, col);
  };

  function merge() {
    const area = normalize(selection);
    const next = cloneSheets(structure.sheets);
    const current = next[sheetIndex];
    if (!current) return;
    const anchor = current.cells[area.r1]?.[area.c1] ?? blankCell();
    anchor.rowSpan = area.r2 - area.r1 + 1;
    anchor.colSpan = area.c2 - area.c1 + 1;
    for (let row = area.r1; row <= area.r2; row += 1) {
      for (let col = area.c1; col <= area.c2; col += 1) {
        if (!current.cells[row]) continue;
        current.cells[row]![col] = row === area.r1 && col === area.c1 ? anchor : null;
      }
    }
    commitSheets(next);
  }

  function unmerge() {
    const next = cloneSheets(structure.sheets);
    const current = next[sheetIndex];
    const cell = current?.cells[selection.r1]?.[selection.c1];
    if (!current || !cell) return;
    for (let row = selection.r1; row < selection.r1 + cell.rowSpan; row += 1) {
      for (let col = selection.c1; col < selection.c1 + cell.colSpan; col += 1) {
        if (!current.cells[row]) current.cells[row] = [];
        current.cells[row]![col] = row === selection.r1 && col === selection.c1 ? { ...cell, rowSpan: 1, colSpan: 1 } : blankCell();
      }
    }
    commitSheets(next);
  }

  function addSheet() {
    if (structure.sheets.length >= MAX_GRID_SHEETS) {
      setNote(`A form can have at most ${MAX_GRID_SHEETS} sheets.`);
      return;
    }
    const next = cloneSheets(structure.sheets);
    next.push({
      name: `Sheet${next.length + 1}`,
      colWidths: Array.from({ length: 8 }, () => 110),
      rowHeights: Array.from({ length: 12 }, () => 24),
      cells: Array.from({ length: 12 }, () => Array.from({ length: 8 }, () => blankCell())),
    });
    commitSheets(next);
    setSheetIndex(next.length - 1);
  }

  const box = normalize(selection);

  /** The row or column just after the selection, counting any merge the selection reaches into. */
  function afterSelection(axis: "row" | "col"): number {
    let edge = axis === "row" ? box.r2 : box.c2;
    for (let row = box.r1; row <= box.r2; row += 1) {
      for (let col = box.c1; col <= box.c2; col += 1) {
        const cell = sheet!.cells[row]?.[col];
        if (!cell) continue;
        edge = Math.max(edge, axis === "row" ? row + cell.rowSpan - 1 : col + cell.colSpan - 1);
      }
    }
    return edge + 1;
  }

  function insertRow(where: "above" | "below") {
    const at = where === "above" ? box.r1 : afterSelection("row");
    const next = insertRows(sheet!, at);
    if (!next) {
      setNote(`A sheet can have at most ${MAX_GRID_ROWS} rows.`);
      return;
    }
    commitSheet(next);
    setNote("");
    if (where === "above") setSelection({ ...selection, r1: selection.r1 + 1, r2: selection.r2 + 1 });
  }

  function insertColumn(where: "left" | "right") {
    const at = where === "left" ? box.c1 : afterSelection("col");
    const next = insertColumns(sheet!, at);
    if (!next) {
      setNote(`A sheet can have at most ${MAX_GRID_COLS} columns.`);
      return;
    }
    commitSheet(next);
    setNote("");
    if (where === "left") setSelection({ ...selection, c1: selection.c1 + 1, c2: selection.c2 + 1 });
  }

  function deleteSelectedRows() {
    const next = deleteRows(sheet!, box.r1, box.r2);
    if (!next) {
      setNote("A sheet needs at least one row.");
      return;
    }
    const referenced = formulasReferencing(sheet!, "row", box.r1, box.r2);
    commitSheet(next);
    const row = Math.min(box.r1, next.rowHeights.length - 1);
    setSelection({ sheet: sheetIndex, r1: row, c1: box.c1, r2: row, c2: box.c1 });
    setNote(referenced.length ? `Formulas follow the rows that moved. ${referenced.join(", ")} referred to a deleted row and now show #REF! where it was.` : "");
  }

  function deleteSelectedColumns() {
    const next = deleteColumns(sheet!, box.c1, box.c2);
    if (!next) {
      setNote("A sheet needs at least one column.");
      return;
    }
    const referenced = formulasReferencing(sheet!, "col", box.c1, box.c2);
    commitSheet(next);
    const col = Math.min(box.c1, next.colWidths.length - 1);
    setSelection({ sheet: sheetIndex, r1: box.r1, c1: col, r2: box.r1, c2: col });
    setNote(referenced.length ? `Formulas follow the columns that moved. ${referenced.join(", ")} referred to a deleted column and now show #REF! where it was.` : "");
  }

  function toggle(flag: StyleFlag) {
    commitSheet(toggleStyleFlag(sheet!, box, flag));
  }

  function setType(type: FormCellType) {
    updateEach((cell) => {
      const next: FormCell = { ...cell, type, locked: type === "label" };
      if (type !== "dropdown") delete next.options;
      else if (!next.options?.length) next.options = ["Option 1", "Option 2"];
      if (type !== "number") {
        delete next.decimals;
        delete next.min;
        delete next.max;
      }
      return next;
    });
    const anchor = sheet!.cells[box.r1]?.[box.c1];
    if (type === "dropdown" && !anchor?.options?.length) setOptionsText("Option 1\nOption 2");
  }

  function commitOptions() {
    const options = optionsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 50);
    if (options.length === 0) {
      setNote("A dropdown needs at least one option.");
      setOptionsText(sheet!.cells[box.r1]?.[box.c1]?.options?.join("\n") ?? "");
      return;
    }
    setNote("");
    updateSelected({ options });
  }

  function setNumberRule(key: "decimals" | "min" | "max", text: string) {
    const patch: Partial<FormCell> = {};
    if (text.trim() === "") patch[key] = undefined;
    else {
      const value = Number(text);
      if (!Number.isFinite(value)) return;
      patch[key] = key === "decimals" ? Math.min(6, Math.max(0, Math.round(value))) : value;
    }
    updateEach((cell) => {
      const next = { ...cell, ...patch };
      if (patch[key] === undefined) delete next[key];
      return next;
    });
  }

  const anchorCell = sheet.cells[box.r1]?.[box.c1] ?? null;
  const anchorType = anchorCell ? effectiveCellType(anchorCell) : "text";
  const barProblem = anchorCell ? cellValueProblem({ ...anchorCell, value: anchorCell.value }) : null;
  const typedFormula = bar.trim().startsWith("=") ? bar.trim() : anchorCell?.formula ? `=${anchorCell.formula}` : "";
  const formulaError = mode === "design" && typedFormula ? formulaProblem(typedFormula) : null;

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="grid-editor">
      {mode === "design" && (
        <div className="no-print flex flex-col gap-1 rounded-md border border-border bg-card p-2 text-sm">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Text and cell style">
            <button type="button" aria-pressed={styleFlagOn(sheet, box, "bold")} className={`${styleFlagOn(sheet, box, "bold") ? pressed : button} font-bold`} onClick={() => toggle("bold")}>Bold</button>
            <button type="button" aria-pressed={styleFlagOn(sheet, box, "italic")} className={`${styleFlagOn(sheet, box, "italic") ? pressed : button} italic`} onClick={() => toggle("italic")}>Italic</button>
            <button type="button" aria-pressed={styleFlagOn(sheet, box, "underline")} className={`${styleFlagOn(sheet, box, "underline") ? pressed : button} underline`} onClick={() => toggle("underline")}>Underline</button>
            <button type="button" aria-pressed={styleFlagOn(sheet, box, "wrap")} className={styleFlagOn(sheet, box, "wrap") ? pressed : button} onClick={() => toggle("wrap")}>Wrap</button>
            <label className="flex items-center gap-1">
              Size
              <input
                key={`size-${selection.r1}-${selection.c1}-${anchorCell?.style.fontSizePt ?? ""}`}
                aria-label="Font size"
                type="number"
                min={6}
                max={72}
                className="fb-control w-14 rounded px-1 py-1"
                defaultValue={anchorCell?.style.fontSizePt ?? ""}
                placeholder="pt"
                onBlur={(event) => {
                  const size = Number(event.target.value);
                  if (event.target.value === "") updateEach((cell) => {
                    const style = { ...cell.style };
                    delete style.fontSizePt;
                    return { ...cell, style };
                  });
                  else if (Number.isFinite(size)) updateSelected({ style: { fontSizePt: Math.min(72, Math.max(6, size)) } });
                }}
              />
            </label>
            <label className="flex items-center gap-1">
              Fill
              <input type="color" className="fb-color" aria-label="Fill color" defaultValue="#0A3C7B" onChange={(event) => updateSelected({ style: { background: event.target.value } })} />
            </label>
            <label className="flex items-center gap-1">
              Text
              <input type="color" className="fb-color" aria-label="Font color" defaultValue="#111111" onChange={(event) => updateSelected({ style: { color: event.target.value } })} />
            </label>
            <select aria-label="Horizontal alignment" className="fb-control rounded px-1 py-1" value={anchorCell?.style.align ?? "left"} onChange={(event) => updateSelected({ style: { align: event.target.value as "left" | "center" | "right" } })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
            <select aria-label="Vertical alignment" className="fb-control rounded px-1 py-1" value={anchorCell?.style.valign ?? "top"} onChange={(event) => updateSelected({ style: { valign: event.target.value as "top" | "middle" | "bottom" } })}>
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Borders">
            <span className="text-muted-foreground">Border</span>
            <select aria-label="Border sides" className="fb-control rounded px-1 py-1" value={borderTarget} onChange={(event) => setBorderTarget(event.target.value as BorderTarget)}>
              {BORDER_TARGETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select aria-label="Border style" className="fb-control rounded px-1 py-1" value={borderLine} onChange={(event) => setBorderLine(event.target.value as BorderLine)}>
              {BORDER_LINES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input type="color" className="fb-color" aria-label="Border color" value={borderColor} onChange={(event) => setBorderColor(event.target.value)} />
            <button type="button" className={button} onClick={() => commitSheet(applyBorders(sheet, box, borderTarget, borderLine, borderColor))}>Apply border</button>
            <span className="mx-1 text-muted-foreground">|</span>
            <button type="button" className={button} onClick={merge}>Merge</button>
            <button type="button" className={button} onClick={unmerge}>Unmerge</button>
            <button type="button" className={button} onClick={() => updateSelected({ conditional: true })}>Pass/Fail color</button>
            <button type="button" className={button} onClick={() => updateSelected({ folderPath: true, locked: true, formula: undefined, value: "" })}>Folder path</button>
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Rows and columns">
            <button type="button" className={button} onClick={() => insertRow("above")}>Insert row above</button>
            <button type="button" className={button} onClick={() => insertRow("below")}>Insert row below</button>
            <button type="button" className={button} onClick={() => insertColumn("left")}>Insert column left</button>
            <button type="button" className={button} onClick={() => insertColumn("right")}>Insert column right</button>
            <button type="button" className={button} onClick={deleteSelectedRows}>Delete row</button>
            <button type="button" className={button} onClick={deleteSelectedColumns}>Delete column</button>
            <label className="flex items-center gap-1">
              Col
              <input
                key={`cw-${sheetIndex}-${box.c1}-${sheet.colWidths[box.c1] ?? 110}`}
                aria-label="Column width"
                type="number"
                className="fb-control w-16 rounded px-1 py-1"
                defaultValue={sheet.colWidths[box.c1] ?? 110}
                onBlur={(event) => {
                  const next = cloneSheets(structure.sheets);
                  const current = next[sheetIndex];
                  if (!current) return;
                  current.colWidths[box.c1] = clampSize(Number(event.target.value), sheet.colWidths[box.c1] ?? 110);
                  commitSheets(next);
                }}
              />
            </label>
            <label className="flex items-center gap-1">
              Row
              <input
                key={`rh-${sheetIndex}-${box.r1}-${sheet.rowHeights[box.r1] ?? 24}`}
                aria-label="Row height"
                type="number"
                className="fb-control w-16 rounded px-1 py-1"
                defaultValue={sheet.rowHeights[box.r1] ?? 24}
                onBlur={(event) => {
                  const next = cloneSheets(structure.sheets);
                  const current = next[sheetIndex];
                  if (!current) return;
                  current.rowHeights[box.r1] = clampSize(Number(event.target.value), sheet.rowHeights[box.r1] ?? 24);
                  commitSheets(next);
                }}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-start gap-2" role="group" aria-label="Cell type">
            <label className="flex items-center gap-1">
              Cell type
              <select aria-label="Cell type" className="fb-control rounded px-1 py-1" value={anchorType} onChange={(event) => setType(event.target.value as FormCellType)}>
                {CELL_TYPE_LABELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {anchorType === "number" && anchorCell ? (
              <>
                {(["decimals", "min", "max"] as const).map((key) => (
                  <label key={key} className="flex items-center gap-1">
                    {key === "decimals" ? "Decimals" : key === "min" ? "Min" : "Max"}
                    <input
                      key={`${key}-${selection.r1}-${selection.c1}-${anchorCell[key] ?? ""}`}
                      aria-label={key === "decimals" ? "Decimals" : key === "min" ? "Minimum" : "Maximum"}
                      type="number"
                      className="fb-control w-20 rounded px-1 py-1"
                      defaultValue={anchorCell[key] ?? ""}
                      onBlur={(event) => setNumberRule(key, event.target.value)}
                    />
                  </label>
                ))}
              </>
            ) : null}
            {anchorType === "dropdown" ? (
              <label className="flex items-start gap-1">
                Options
                <textarea
                  aria-label="Dropdown options"
                  className="fb-control h-20 w-48 rounded px-1 py-1"
                  placeholder="One option per line"
                  value={optionsText}
                  onChange={(event) => setOptionsText(event.target.value)}
                  onBlur={commitOptions}
                />
              </label>
            ) : null}
            {anchorType === "signature" ? <span className="text-muted-foreground">A signature placeholder. Signing comes later.</span> : null}
            <button type="button" className={button} onClick={() => updateSelected({ locked: true })}>Lock label</button>
            <button type="button" className={button} onClick={() => updateSelected({ locked: false, formula: undefined })}>Input cell</button>
          </div>
          {note ? <p role="status" className="text-xs text-muted-foreground">{note}</p> : null}
        </div>
      )}
      {mode === "design" && (
        <label className="no-print flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{addressOf(selection.c1 + 1, selection.r1 + 1)}</span>
          <input
            aria-label="Formula bar"
            className="fb-formula min-w-0 flex-1 rounded px-2 py-1"
            value={bar}
            onChange={(event) => setBar(event.target.value)}
            onBlur={applyBar}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyBar();
            }}
          />
        </label>
      )}
      {formulaError ? (
        <p role="alert" className="no-print text-xs text-destructive" data-testid="formula-error">
          {addressOf(selection.c1 + 1, selection.r1 + 1)}: {formulaError}
        </p>
      ) : null}
      {mode === "design" && barProblem ? (
        <p role="alert" className="no-print text-xs text-destructive">
          {barProblem}. This {anchorType} cell keeps what you typed, but the value does not fit its type.
        </p>
      ) : null}
      <div className={wide ? "aq-print-wide overflow-auto" : "overflow-auto"} data-testid="grid-sheet">
        <table className="fb-grid">
          <colgroup>
            <col style={{ width: 36 }} />
            {sheet.colWidths.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th />
              {sheet.colWidths.map((_, index) => (
                <th key={index}>{addressOf(index + 1, 1).replace(/[0-9]/g, "")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.cells.map((row, rowIndex) => (
              <tr key={rowIndex} style={{ height: sheet.rowHeights[rowIndex] ?? 24 }}>
                <th>{rowIndex + 1}</th>
                {row.map((cell, colIndex) => {
                  if (!cell) return null;
                  const answerKey = `${sheetIndex}!${addressOf(colIndex + 1, rowIndex + 1)}`;
                  const answer = answers?.[answerKey];
                  const isSignature = cell.type === "signature";
                  const text = isSignature ? "Signature" : cell.folderPath && !folderPath && mode === "design" ? "Folder path" : shownCell(cell, calculated, colIndex + 1, rowIndex + 1, answer, folderPath);
                  const paint = cellPaint(cell, text);
                  const inSelection = mode === "design" && rowIndex >= box.r1 && rowIndex <= box.r2 && colIndex >= box.c1 && colIndex <= box.c2;
                  const problem = mode === "design" ? (cell.formula ? formulaProblem(cell.formula) : cellValueProblem(cell)) : null;
                  const editable = mode === "fill" && !cell.locked && !cell.formula && !cell.folderPath && !isSignature;
                  const left = colIndex > 0 ? row[colIndex - 1] : null;
                  const locationInsert = editable ? gridLocationInsert(cell.value, answer, folderPath, Boolean(left && !left.formula && isExactLocationLabel(left.value))) : null;
                  return (
                    <td
                      key={colIndex}
                      rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                      colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                      className={[inSelection ? "fb-selected" : "", problem ? "fb-invalid" : ""].filter(Boolean).join(" ") || undefined}
                      title={problem ?? undefined}
                      style={{
                        background: paint.background,
                        color: paint.color,
                        fontWeight: cell.style.bold ? 700 : undefined,
                        fontStyle: cell.style.italic || isSignature ? "italic" : undefined,
                        textDecoration: cell.style.underline ? "underline" : undefined,
                        fontFamily: cell.style.fontFamily,
                        fontSize: cell.style.fontSizePt ? `${cell.style.fontSizePt}pt` : undefined,
                        textAlign: cell.style.align,
                        verticalAlign: cell.style.valign,
                        borderTop: cell.style.borderTop,
                        borderRight: cell.style.borderRight,
                        borderBottom: cell.style.borderBottom,
                        borderLeft: cell.style.borderLeft,
                        whiteSpace: cell.style.wrap ? "pre-wrap" : undefined,
                      }}
                      onMouseDown={(event) => {
                        if (mode !== "design") return;
                        select(rowIndex, colIndex, event.shiftKey);
                      }}
                    >
                      {editable ? (
                        <span className="flex min-w-0 flex-col">
                          <input aria-label={answerKey} value={answers?.[answerKey] ?? cell.value} onChange={(event) => onAnswer?.(answerKey, event.target.value)} />
                          {locationInsert ? (
                            <button type="button" className="no-print px-1 text-left text-[10px] text-[#0A3C7B]" onClick={() => onAnswer?.(answerKey, locationInsert)}>
                              Insert current path
                            </button>
                          ) : null}
                        </span>
                      ) : (
                        <span className={`fb-read${cell.folderPath ? " fb-folder-path select-text" : ""}`}>{text}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="no-print flex flex-wrap items-center gap-1">
        {structure.sheets.map((item, index) => (
          <button key={item.name + index} type="button" className={`rounded border px-2 py-1 text-sm ${index === sheetIndex ? "border-primary text-primary" : "border-border"}`} onClick={() => setSheetIndex(index)}>
            {mode === "design" ? (
              <input
                aria-label={`Sheet ${index + 1} name`}
                className="fb-plain w-24 bg-transparent"
                value={item.name}
                onChange={(event) => {
                  const next = cloneSheets(structure.sheets);
                  if (next[index]) next[index]!.name = event.target.value;
                  commitSheets(next);
                }}
              />
            ) : (
              item.name
            )}
          </button>
        ))}
        {mode === "design" && (
          <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={addSheet}>
            Add sheet
          </button>
        )}
      </div>
    </div>
  );
}

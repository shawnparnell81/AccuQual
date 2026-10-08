import { useMemo, useState } from "react";
import { useItemFolderPath } from "../../components/documents/ItemFolderPath";
import { gridLocationInsert, isExactLocationLabel } from "../../lib/folderPath";
import { addressOf, blankCell, cellPaint, evaluatedSheet, shownCell, type FormCell, type FormSheet, type GridFormStructure } from "../../lib/formGrid";
import "./formBuilder.css";

interface Selection {
  sheet: number;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

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
  const folderPath = useItemFolderPath();
  const sheet = structure.sheets[sheetIndex] ?? structure.sheets[0];
  const calculated = useMemo(() => (sheet ? evaluatedSheet(sheet, answers, String(sheetIndex)) : {}), [sheet, answers, sheetIndex]);
  if (!sheet) return null;
  const wide = sheet.colWidths.reduce((sum, width) => sum + width, 0) > 760;

  function commitSheets(next: FormSheet[]) {
    onChange?.({ kind: "grid", sheets: next });
  }

  function updateSelected(patch: Partial<FormCell>) {
    const next = cloneSheets(structure.sheets);
    const current = next[sheetIndex];
    if (!current) return;
    const box = normalize(selection);
    for (let row = box.r1; row <= box.r2; row += 1) {
      for (let col = box.c1; col <= box.c2; col += 1) {
        const cell = current.cells[row]?.[col];
        if (!cell) continue;
        current.cells[row]![col] = { ...cell, ...patch, style: patch.style ? { ...cell.style, ...patch.style } : cell.style };
      }
    }
    commitSheets(next);
  }

  const applyBar = () => {
    const cell = sheet.cells[selection.r1]?.[selection.c1];
    if (!cell || mode !== "design") return;
    const text = bar.trim();
    if (text.startsWith("=")) updateSelected({ formula: text.slice(1), value: "" });
    else updateSelected({ formula: undefined, value: bar });
  }

  const select = (row: number, col: number, extend: boolean) => {
    const next = extend ? { ...selection, sheet: sheetIndex, r2: row, c2: col } : { sheet: sheetIndex, r1: row, c1: col, r2: row, c2: col };
    setSelection(next);
    const cell = sheet.cells[row]?.[col];
    setBar(cell?.formula ? `=${cell.formula}` : (cell?.value ?? ""));
  }

  function merge() {
    const box = normalize(selection);
    const next = cloneSheets(structure.sheets);
    const current = next[sheetIndex];
    if (!current) return;
    const anchor = current.cells[box.r1]?.[box.c1] ?? blankCell();
    anchor.rowSpan = box.r2 - box.r1 + 1;
    anchor.colSpan = box.c2 - box.c1 + 1;
    for (let row = box.r1; row <= box.r2; row += 1) {
      for (let col = box.c1; col <= box.c2; col += 1) {
        if (!current.cells[row]) continue;
        current.cells[row]![col] = row === box.r1 && col === box.c1 ? anchor : null;
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

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="grid-editor">
      {mode === "design" && (
        <div className="no-print flex flex-wrap items-center gap-1 rounded-md border border-border bg-card p-2 text-sm">
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => updateSelected({ style: { bold: true } })}>Bold</button>
          <button type="button" className="rounded border border-border px-2 py-1 italic" onClick={() => updateSelected({ style: { italic: true } })}>Italic</button>
          <button type="button" className="rounded border border-border px-2 py-1 underline" onClick={() => updateSelected({ style: { underline: true } })}>Underline</button>
          <label className="flex items-center gap-1">
            Fill
            <input type="color" aria-label="Fill color" onChange={(event) => updateSelected({ style: { background: event.target.value } })} />
          </label>
          <label className="flex items-center gap-1">
            Font
            <input type="color" aria-label="Font color" onChange={(event) => updateSelected({ style: { color: event.target.value } })} />
          </label>
          <select aria-label="Alignment" className="rounded border border-border bg-background px-1 py-1" onChange={(event) => updateSelected({ style: { align: event.target.value as "left" | "center" | "right" } })}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => updateSelected({ style: { borderTop: "1px solid #1a1a1a", borderRight: "1px solid #1a1a1a", borderBottom: "1px solid #1a1a1a", borderLeft: "1px solid #1a1a1a" } })}>Borders</button>
          <button type="button" className="rounded border border-border px-2 py-1" onClick={merge}>Merge</button>
          <button type="button" className="rounded border border-border px-2 py-1" onClick={unmerge}>Unmerge</button>
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => updateSelected({ locked: true })}>Lock label</button>
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => updateSelected({ locked: false, formula: undefined })}>Input cell</button>
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => updateSelected({ conditional: true })}>Pass/Fail color</button>
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => updateSelected({ folderPath: true, locked: true, formula: undefined, value: "" })}>Folder path</button>
          <label className="flex items-center gap-1">
            Col
            <input
              aria-label="Column width"
              type="number"
              className="w-16 rounded border border-border bg-background px-1 py-1"
              value={sheet.colWidths[box.c1] ?? 110}
              onChange={(event) => {
                const next = cloneSheets(structure.sheets);
                const current = next[sheetIndex];
                if (!current) return;
                current.colWidths[box.c1] = Number(event.target.value) || 80;
                commitSheets(next);
              }}
            />
          </label>
          <label className="flex items-center gap-1">
            Row
            <input
              aria-label="Row height"
              type="number"
              className="w-16 rounded border border-border bg-background px-1 py-1"
              value={sheet.rowHeights[box.r1] ?? 24}
              onChange={(event) => {
                const next = cloneSheets(structure.sheets);
                const current = next[sheetIndex];
                if (!current) return;
                current.rowHeights[box.r1] = Number(event.target.value) || 22;
                commitSheets(next);
              }}
            />
          </label>
        </div>
      )}
      {mode === "design" && (
        <label className="no-print flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{addressOf(selection.c1 + 1, selection.r1 + 1)}</span>
          <input
            aria-label="Formula bar"
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
            value={bar}
            onChange={(event) => setBar(event.target.value)}
            onBlur={applyBar}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyBar();
            }}
          />
        </label>
      )}
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
                  const text = cell.folderPath && !folderPath && mode === "design" ? "Folder path" : shownCell(cell, calculated, colIndex + 1, rowIndex + 1, answer, folderPath);
                  const paint = cellPaint(cell, text);
                  const selected = mode === "design" && rowIndex >= box.r1 && rowIndex <= box.r2 && colIndex >= box.c1 && colIndex <= box.c2;
                  const editable = mode === "fill" && !cell.locked && !cell.formula && !cell.folderPath;
                  const left = colIndex > 0 ? row[colIndex - 1] : null;
                  const locationInsert = editable ? gridLocationInsert(cell.value, answer, folderPath, Boolean(left && !left.formula && isExactLocationLabel(left.value))) : null;
                  return (
                    <td
                      key={colIndex}
                      rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                      colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                      className={selected ? "fb-selected" : undefined}
                      style={{
                        background: paint.background,
                        color: paint.color,
                        fontWeight: cell.style.bold ? 700 : undefined,
                        fontStyle: cell.style.italic ? "italic" : undefined,
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
                className="w-24 bg-transparent"
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

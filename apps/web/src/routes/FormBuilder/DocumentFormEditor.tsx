import { useEffect, useRef, useState } from "react";
import type { DocumentFormStructure } from "../../lib/formGrid";
import "./formBuilder.css";

function run(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export function DocumentFormEditor({
  structure,
  onChange,
  mode,
  answers,
  onAnswer,
}: {
  structure: DocumentFormStructure;
  onChange?: (next: DocumentFormStructure) => void;
  mode: "design" | "fill";
  answers?: Record<string, string>;
  onAnswer?: (key: string, value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState(structure.html);

  useEffect(() => {
    if (mode !== "design") return;
    if (ref.current && document.activeElement !== ref.current) ref.current.innerHTML = structure.html;
    setHtml(structure.html);
  }, [structure.html, mode]);

  function insertField() {
    const label = window.prompt("Field label", "Name");
    if (!label?.trim()) return;
    const id = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    run("insertHTML", `<span class="fb-inline-field" data-fill-field="${id}" data-label="${label.trim()}" contenteditable="false">${label.trim()}</span>&nbsp;`);
    if (ref.current) onChange?.({ ...structure, html: ref.current.innerHTML });
  }

  function insertTable() {
    run("insertHTML", "<table><tbody><tr><td> </td><td> </td></tr><tr><td> </td><td> </td></tr></tbody></table><p></p>");
    if (ref.current) onChange?.({ ...structure, html: ref.current.innerHTML });
  }

  if (mode === "fill") {
    const parts = structure.html.split(/(<span class="fb-inline-field"[^>]*>.*?<\/span>)/g);
    return (
      <div className="fb-doc" data-testid="document-fill">
        {parts.map((part, index) => {
          const match = /data-fill-field="([^"]*)"[^>]*data-label="([^"]*)"/.exec(part);
          if (!match) return <span key={index} dangerouslySetInnerHTML={{ __html: part }} />;
          const key = match[1] ?? "";
          return (
            <input
              key={index}
              aria-label={match[2] || key}
              className="fb-inline-field"
              value={answers?.[key] ?? ""}
              onChange={(event) => onAnswer?.(key, event.target.value)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="document-editor">
      <div className="no-print flex flex-wrap gap-1 rounded-md border border-border bg-card p-2 text-sm">
        <button type="button" className="rounded border border-border px-2 py-1" onClick={() => run("formatBlock", "H1")}>Heading</button>
        <button type="button" className="rounded border border-border px-2 py-1" onClick={() => run("formatBlock", "H2")}>Subheading</button>
        <button type="button" className="rounded border border-border px-2 py-1" onClick={() => run("formatBlock", "P")}>Paragraph</button>
        <button type="button" className="rounded border border-border px-2 py-1 font-bold" onClick={() => run("bold")}>B</button>
        <button type="button" className="rounded border border-border px-2 py-1 italic" onClick={() => run("italic")}>I</button>
        <button type="button" className="rounded border border-border px-2 py-1 underline" onClick={() => run("underline")}>U</button>
        <button type="button" className="rounded border border-border px-2 py-1" onClick={() => run("insertUnorderedList")}>Bullets</button>
        <button type="button" className="rounded border border-border px-2 py-1" onClick={() => run("insertOrderedList")}>Numbers</button>
        <button type="button" className="rounded border border-border px-2 py-1" onClick={insertTable}>Table</button>
        <button type="button" className="rounded border border-border px-2 py-1" onClick={() => run("insertHTML", '<div class="aq-page-break" contenteditable="false"></div><p></p>')}>Page break</button>
        <button type="button" className="rounded border border-border px-2 py-1" onClick={insertField}>Fillable field</button>
        <label className="rounded border border-border px-2 py-1">
          Image
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                run("insertHTML", `<img src="${String(reader.result)}" alt="" style="max-width:100%" />`);
                if (ref.current) onChange?.({ ...structure, html: ref.current.innerHTML });
              };
              reader.readAsDataURL(file);
            }}
          />
        </label>
      </div>
      <div
        ref={ref}
        className="fb-doc"
        contentEditable
        role="textbox"
        aria-label="Document"
        suppressContentEditableWarning
        onInput={() => {
          const next = ref.current?.innerHTML ?? html;
          setHtml(next);
          onChange?.({ ...structure, html: next });
        }}
      />
    </div>
  );
}

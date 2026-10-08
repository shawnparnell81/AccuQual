import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  DOC_FIELDS,
  bandHasContent,
  bandHtmlForPage,
  emptyBand,
  fieldToken,
  slotHtml,
  withSlot,
  type BandSlot,
  type DocumentBand,
} from "../../lib/documentBands";
import type { DocumentFormStructure } from "../../lib/formGrid";
import "./formBuilder.css";

function run(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function keepBand(band: DocumentBand): DocumentBand | null {
  if (bandHasContent(band) || band.differentFirstPage || band.differentOddEven) return band;
  return null;
}

function BandSource({ name, band }: { name: "header" | "footer"; band: DocumentBand | null | undefined }) {
  if (!band || !bandHasContent(band)) return null;
  return (
    <div
      hidden
      data-print-band={name}
      data-different-first={String(band.differentFirstPage)}
      data-different-even={String(band.differentOddEven)}
    >
      <div data-variant="default" dangerouslySetInnerHTML={{ __html: band.defaultHtml }} />
      <div data-variant="first" dangerouslySetInnerHTML={{ __html: band.firstHtml }} />
      <div data-variant="even" dangerouslySetInnerHTML={{ __html: band.evenHtml }} />
    </div>
  );
}

function BandEditor({
  kind,
  band,
  editable,
  editorRef,
  onFocus,
  onBand,
}: {
  kind: "header" | "footer";
  band: DocumentBand | null | undefined;
  editable: boolean;
  editorRef?: MutableRefObject<HTMLDivElement | null>;
  onFocus?: () => void;
  onBand?: (next: DocumentBand) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [slot, setSlot] = useState<BandSlot>(band?.differentFirstPage ? "first" : "default");
  const current = band ?? emptyBand();
  const options: { id: BandSlot; label: string }[] = [];
  if (current.differentFirstPage) options.push({ id: "first", label: "First page" });
  if (current.differentOddEven) options.push({ id: "even", label: "Even pages" });
  options.push({
    id: "default",
    label: current.differentOddEven ? "Odd pages" : current.differentFirstPage ? "Other pages" : "All pages",
  });
  const active: BandSlot = options.some((option) => option.id === slot) ? slot : "default";
  const html = editable ? slotHtml(current, active) : bandHtmlForPage(current, 1);

  useEffect(() => {
    if (!editable) return;
    if (ref.current && document.activeElement !== ref.current) ref.current.innerHTML = html;
  }, [html, editable]);

  if (!editable) {
    if (!bandHasContent(band)) return null;
    return (
      <div className={`fb-band fb-band-${kind}`} data-testid={`document-${kind}`}>
        <div className="fb-band-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }

  return (
    <section className={`fb-band fb-band-${kind} ${bandHasContent(band) ? "" : "fb-band-empty"}`} data-testid={`document-${kind}`}>
      <div className="no-print fb-band-bar">
        <span>{kind === "header" ? "Header" : "Footer"}</span>
        <label>
          <input
            type="checkbox"
            checked={current.differentFirstPage}
            onChange={(event) => onBand?.({ ...current, differentFirstPage: event.target.checked })}
          />{" "}
          Different first page
        </label>
        <label>
          <input
            type="checkbox"
            checked={current.differentOddEven}
            onChange={(event) => onBand?.({ ...current, differentOddEven: event.target.checked })}
          />{" "}
          Different odd and even
        </label>
        {options.length > 1 ? (
          <select aria-label={`${kind} variant`} value={active} onChange={(event) => setSlot(event.target.value as BandSlot)}>
            {options.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        ) : null}
      </div>
      <div
        ref={(node) => {
          ref.current = node;
          if (editorRef) editorRef.current = node;
        }}
        className="fb-band-body"
        contentEditable
        role="textbox"
        aria-label={kind === "header" ? "Header" : "Footer"}
        data-region={kind}
        suppressContentEditableWarning
        onFocus={onFocus}
        onInput={() => onBand?.(withSlot(current, active, ref.current?.innerHTML ?? ""))}
      />
    </section>
  );
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
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const active = useRef<"body" | "header" | "footer">("body");
  const [html, setHtml] = useState(structure.html);
  const design = mode === "design";
  const headerInFlow = bandHasContent(structure.header);
  const footerInFlow = bandHasContent(structure.footer);

  useEffect(() => {
    if (!design) return;
    if (bodyRef.current && document.activeElement !== bodyRef.current) bodyRef.current.innerHTML = structure.html;
    setHtml(structure.html);
  }, [structure.html, design]);

  function updateHeader(next: DocumentBand) {
    onChange?.({ ...structure, header: keepBand(next) });
  }
  function updateFooter(next: DocumentBand) {
    onChange?.({ ...structure, footer: keepBand(next) });
  }

  function insert(snippet: string) {
    const region = active.current;
    const target = region === "header" ? headerRef.current : region === "footer" ? footerRef.current : bodyRef.current;
    target?.focus();
    run("insertHTML", snippet);
    const next = target?.innerHTML ?? "";
    if (region === "header") target?.dispatchEvent(new Event("input", { bubbles: true }));
    else if (region === "footer") target?.dispatchEvent(new Event("input", { bubbles: true }));
    else {
      setHtml(next);
      onChange?.({ ...structure, html: next });
    }
  }

  function insertField() {
    const label = window.prompt("Field label", "Name");
    if (!label?.trim()) return;
    const id = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    insert(`<span class="fb-inline-field" data-fill-field="${id}" data-label="${label.trim()}" contenteditable="false">${label.trim()}</span>&nbsp;`);
  }

  const headerEditor = (
    <BandEditor
      kind="header"
      band={structure.header}
      editable={design}
      editorRef={headerRef}
      onFocus={() => { active.current = "header"; }}
      onBand={updateHeader}
    />
  );
  const footerEditor = (
    <BandEditor
      kind="footer"
      band={structure.footer}
      editable={design}
      editorRef={footerRef}
      onFocus={() => { active.current = "footer"; }}
      onBand={updateFooter}
    />
  );

  if (!design) {
    const parts = structure.html.split(/(<span class="fb-inline-field"[^>]*>.*?<\/span>)/g);
    return (
      <div data-testid="document-fill">
        <BandSource name="header" band={structure.header} />
        <BandSource name="footer" band={structure.footer} />
        <table className="fb-print-flow">
          {headerInFlow ? <thead><tr><td>{headerEditor}</td></tr></thead> : null}
          <tbody>
            <tr>
              <td>
                <div className="fb-doc">
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
              </td>
            </tr>
          </tbody>
          {footerInFlow ? <tfoot><tr><td>{footerEditor}</td></tr></tfoot> : null}
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="document-editor">
      <div className="no-print flex flex-wrap gap-1 rounded-md border border-border bg-card p-2 text-sm">
        <button type="button" className="rounded border border-border px-2 py-1" onMouseDown={(event) => event.preventDefault()} onClick={() => run("formatBlock", "H1")}>Heading</button>
        <button type="button" className="rounded border border-border px-2 py-1" onMouseDown={(event) => event.preventDefault()} onClick={() => run("formatBlock", "H2")}>Subheading</button>
        <button type="button" className="rounded border border-border px-2 py-1" onMouseDown={(event) => event.preventDefault()} onClick={() => run("formatBlock", "P")}>Paragraph</button>
        <button type="button" className="rounded border border-border px-2 py-1 font-bold" onMouseDown={(event) => event.preventDefault()} onClick={() => run("bold")}>B</button>
        <button type="button" className="rounded border border-border px-2 py-1 italic" onMouseDown={(event) => event.preventDefault()} onClick={() => run("italic")}>I</button>
        <button type="button" className="rounded border border-border px-2 py-1 underline" onMouseDown={(event) => event.preventDefault()} onClick={() => run("underline")}>U</button>
        <button type="button" className="rounded border border-border px-2 py-1" onMouseDown={(event) => event.preventDefault()} onClick={() => run("insertUnorderedList")}>Bullets</button>
        <button type="button" className="rounded border border-border px-2 py-1" onMouseDown={(event) => event.preventDefault()} onClick={() => run("insertOrderedList")}>Numbers</button>
        <button type="button" className="rounded border border-border px-2 py-1" onMouseDown={(event) => event.preventDefault()} onClick={() => insert("<table><tbody><tr><td> </td><td> </td></tr><tr><td> </td><td> </td></tr></tbody></table><p></p>")}>Table</button>
        <button type="button" className="rounded border border-border px-2 py-1" onMouseDown={(event) => event.preventDefault()} onClick={() => insert('<div class="aq-page-break" contenteditable="false"></div><p></p>')}>Page break</button>
        <button type="button" className="rounded border border-border px-2 py-1" onMouseDown={(event) => event.preventDefault()} onClick={insertField}>Fillable field</button>
        {DOC_FIELDS.map((field) => (
          <button
            key={field.id}
            type="button"
            className="rounded border border-border px-2 py-1"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insert(fieldToken(field.id, field.label))}
          >
            {field.label}
          </button>
        ))}
        <label className="rounded border border-border px-2 py-1">
          Image
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => insert(`<img src="${String(reader.result)}" alt="" />`);
              reader.readAsDataURL(file);
            }}
          />
        </label>
      </div>
      <BandSource name="header" band={structure.header} />
      <BandSource name="footer" band={structure.footer} />
      {!headerInFlow ? headerEditor : null}
      <table className="fb-print-flow">
        {headerInFlow ? <thead><tr><td>{headerEditor}</td></tr></thead> : null}
        <tbody>
          <tr>
            <td>
              <div
                ref={bodyRef}
                className="fb-doc"
                contentEditable
                role="textbox"
                aria-label="Document"
                data-region="body"
                suppressContentEditableWarning
                onFocus={() => { active.current = "body"; }}
                onInput={() => {
                  const next = bodyRef.current?.innerHTML ?? html;
                  setHtml(next);
                  onChange?.({ ...structure, html: next });
                }}
              />
            </td>
          </tr>
        </tbody>
        {footerInFlow ? <tfoot><tr><td>{footerEditor}</td></tr></tfoot> : null}
      </table>
      {!footerInFlow ? footerEditor : null}
    </div>
  );
}

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useItemFolderPath } from "../../components/documents/ItemFolderPath";
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
import type { DocumentChromeField, DocumentFormStructure } from "../../lib/formGrid";
import { isExactLocationLabel } from "../../lib/folderPath";
import "./formBuilder.css";

const FOLDER_PATH_SPAN = /<span class="fb-folder-path"[^>]*>[\s\S]*?<\/span>/gi;

function run(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function showFolderPath(html: string, path: string): string {
  if (!path) return html;
  return html.replace(FOLDER_PATH_SPAN, path);
}

function keepBand(band: DocumentBand): DocumentBand | null {
  if (bandHasContent(band) || band.differentFirstPage || band.differentOddEven) return band;
  return null;
}

function BandSource({ name, band, folderPath }: { name: "header" | "footer"; band: DocumentBand | null | undefined; folderPath: string }) {
  if (!band || !bandHasContent(band)) return null;
  return (
    <div
      hidden
      data-print-band={name}
      data-different-first={String(band.differentFirstPage)}
      data-different-even={String(band.differentOddEven)}
    >
      <div data-variant="default" dangerouslySetInnerHTML={{ __html: showFolderPath(band.defaultHtml, folderPath) }} />
      <div data-variant="first" dangerouslySetInnerHTML={{ __html: showFolderPath(band.firstHtml, folderPath) }} />
      <div data-variant="even" dangerouslySetInnerHTML={{ __html: showFolderPath(band.evenHtml, folderPath) }} />
    </div>
  );
}

function BandEditor({
  kind,
  band,
  editable,
  folderPath,
  editorRef,
  onFocus,
  onBand,
}: {
  kind: "header" | "footer";
  band: DocumentBand | null | undefined;
  editable: boolean;
  folderPath: string;
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
  const html = editable ? slotHtml(current, active) : showFolderPath(bandHtmlForPage(current, 1), folderPath);

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
  const folderPath = useItemFolderPath();
  const chrome = structure.chrome ?? [];
  const headerInFlow = bandHasContent(structure.header);
  const footerInFlow = bandHasContent(structure.footer);

  function addFolderPath(place: "header" | "footer") {
    const field: DocumentChromeField = { id: `path-${Math.random().toString(36).slice(2, 8)}`, place, kind: "folderPath", label: "Folder path" };
    onChange?.({ ...structure, chrome: [...chrome, field] });
  }

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
      folderPath={folderPath}
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
      folderPath={folderPath}
      editorRef={footerRef}
      onFocus={() => { active.current = "footer"; }}
      onBand={updateFooter}
    />
  );
  const headerChrome = (
    <DocumentChrome
      place="header"
      fields={chrome}
      folderPath={folderPath}
      onRemove={design ? (id) => onChange?.({ ...structure, chrome: chrome.filter((field) => field.id !== id) }) : undefined}
    />
  );
  const footerChrome = (
    <DocumentChrome
      place="footer"
      fields={chrome}
      folderPath={folderPath}
      onRemove={design ? (id) => onChange?.({ ...structure, chrome: chrome.filter((field) => field.id !== id) }) : undefined}
    />
  );

  if (!design) {
    const parts = structure.html.split(/(<span class="fb-inline-field"[^>]*>.*?<\/span>|<span class="fb-folder-path"[^>]*>.*?<\/span>)/g);
    return (
      <div data-testid="document-fill">
        <BandSource name="header" band={structure.header} folderPath={folderPath} />
        <BandSource name="footer" band={structure.footer} folderPath={folderPath} />
        <table className="fb-print-flow">
          {headerInFlow ? (
            <thead>
              <tr>
                <td>
                  {headerChrome}
                  {headerEditor}
                </td>
              </tr>
            </thead>
          ) : null}
          <tbody>
            <tr>
              <td>
                {!headerInFlow ? headerChrome : null}
                <div className="fb-doc">
                  {parts.map((part, index) => {
                    if (/data-folder-path=/.test(part)) {
                      return (
                        <span key={index} className="fb-folder-path select-text">
                          {folderPath}
                        </span>
                      );
                    }
                    const match = /data-fill-field="([^"]*)"[^>]*data-label="([^"]*)"/.exec(part);
                    if (!match) return <span key={index} dangerouslySetInnerHTML={{ __html: part }} />;
                    const key = match[1] ?? "";
                    const label = match[2] || key;
                    const current = answers?.[key] ?? "";
                    return (
                      <span key={index}>
                        <input
                          aria-label={label}
                          className="fb-inline-field"
                          value={current}
                          onChange={(event) => onAnswer?.(key, event.target.value)}
                        />
                        {isExactLocationLabel(label) && !current.trim() && folderPath ? (
                          <button type="button" className="no-print ml-1 text-xs text-[#0A3C7B]" onClick={() => onAnswer?.(key, folderPath)}>
                            Insert current path
                          </button>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
                {!footerInFlow ? footerChrome : null}
              </td>
            </tr>
          </tbody>
          {footerInFlow ? (
            <tfoot>
              <tr>
                <td>
                  {footerEditor}
                  {footerChrome}
                </td>
              </tr>
            </tfoot>
          ) : null}
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
        <button type="button" className="rounded border border-border px-2 py-1" onMouseDown={(event) => event.preventDefault()} onClick={() => addFolderPath("header")}>Header folder path</button>
        <button type="button" className="rounded border border-border px-2 py-1" onMouseDown={(event) => event.preventDefault()} onClick={() => addFolderPath("footer")}>Footer folder path</button>
        <button type="button" className="rounded border border-border px-2 py-1" onMouseDown={(event) => event.preventDefault()} onClick={() => insert(`<span class="fb-folder-path" data-folder-path="true" contenteditable="false">Folder path</span>&nbsp;`)}>Folder path</button>
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
      <BandSource name="header" band={structure.header} folderPath={folderPath} />
      <BandSource name="footer" band={structure.footer} folderPath={folderPath} />
      {!headerInFlow ? (
        <>
          {headerChrome}
          {headerEditor}
        </>
      ) : null}
      <table className="fb-print-flow">
        {headerInFlow ? (
          <thead>
            <tr>
              <td>
                {headerChrome}
                {headerEditor}
              </td>
            </tr>
          </thead>
        ) : null}
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
        {footerInFlow ? (
          <tfoot>
            <tr>
              <td>
                {footerEditor}
                {footerChrome}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
      {!footerInFlow ? (
        <>
          {footerEditor}
          {footerChrome}
        </>
      ) : null}
    </div>
  );
}

function DocumentChrome({
  place,
  fields,
  folderPath,
  onRemove,
}: {
  place: "header" | "footer";
  fields: DocumentChromeField[];
  folderPath: string;
  onRemove?: (id: string) => void;
}) {
  const rows = fields.filter((field) => field.place === place && field.kind === "folderPath");
  if (rows.length === 0) return null;
  return (
    <div className={place === "header" ? "mb-2 flex flex-col gap-1" : "mt-3 flex flex-col gap-1"} data-testid={`folder-path-${place}`}>
      {rows.map((field) => (
        <div key={field.id} className="flex flex-wrap items-center gap-2 text-xs text-[#1a1a1a]">
          <span>{field.label}:</span>
          <span className="fb-folder-path select-text">{folderPath || (onRemove ? "Folder path" : "")}</span>
          {onRemove ? (
            <button type="button" className="no-print text-[#475467]" onClick={() => onRemove(field.id)}>
              Remove
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

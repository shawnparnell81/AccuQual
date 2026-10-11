import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { apiClient } from "../../api/client";
import { uploadAttachmentFor } from "../../lib/attachments";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { textStillDirty } from "../../lib/capaStep";
import { formatPictureToken, parsePictureText, preparePictureFile, type PicturePart } from "./pictureText";

const urls = new Map<number, string>();
const loading = new Map<number, Promise<string>>();

export function rememberPictureUrl(id: number, url: string) {
  urls.set(id, url);
}

/** A picture address is only the blob URL this page created for that file. */
function pictureSrc(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "blob:") return null;
    return encodeURI(parsed.href);
  } catch {
    return null;
  }
}

async function pictureObjectUrl(id: number): Promise<string> {
  if (!Number.isInteger(id) || id <= 0) throw new Error("Picture unavailable");
  const cached = urls.get(id);
  if (cached) return cached;
  let pending = loading.get(id);
  if (!pending) {
    const path = `/attachments/${encodeURIComponent(String(id))}/download`;
    pending = apiClient.get(path, { responseType: "blob" }).then((res) => {
      const url = URL.createObjectURL(res.data as Blob);
      const src = pictureSrc(url);
      if (!src) throw new Error("Picture unavailable");
      urls.set(id, src);
      loading.delete(id);
      return src;
    });
    loading.set(id, pending);
  }
  return pending;
}

function serialize(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.pictureId) {
      const width = node.dataset.pictureWidth ? Number(node.dataset.pictureWidth) : undefined;
      out += formatPictureToken(Number(node.dataset.pictureId), width, node.dataset.pictureCaption ?? "");
      return;
    }
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    const block = node.tagName === "DIV" || node.tagName === "P";
    if (block && out && !out.endsWith("\n")) out += "\n";
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out.replace(/\u00a0/g, " ");
}

interface PictureTextProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  frameClassName?: string;
  rows?: number;
  placeholder?: string;
  ariaLabel?: string;
  entityType?: string;
  entityId?: number;
  /** Issue and evidence fields keep this. Ordinary form text leaves it off. */
  allowInsert?: boolean;
  onBlur?: () => void;
}

/**
 * The same text field as before, plus pictures placed in the text.
 * Paste, drop, or Insert Picture on issue and evidence fields. Ordinary
 * form text keeps the words and any picture already saved, without the control.
 *
 * Insert Picture is not a real button, and the file input is rendered
 * outside this tree. A surrounding label treats the first button or file
 * input as its control and opens the file picker on any click in the text.
 */
export function PictureText({
  value,
  onChange,
  readOnly = false,
  className,
  frameClassName,
  rows = 4,
  placeholder,
  ariaLabel,
  entityType,
  entityId,
  allowInsert = true,
  onBlur,
}: PictureTextProps) {
  const toast = useToast();
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const own = useRef<string | null>(null);
  const caret = useRef<Range | null>(null);
  const canInsert = allowInsert && !readOnly && entityType != null && entityId != null;

  function commit(next: string) {
    own.current = next;
    if (next !== value) onChange(next);
  }

  function rememberCaret() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    if (editor.contains(selection.anchorNode)) caret.current = selection.getRangeAt(0).cloneRange();
  }

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === own.current) return;
    own.current = value;
    paint(editor, value, readOnly, () => commit(serialize(editor)));
  }, [value, readOnly]);

  async function addFiles(files: File[], atSelection: boolean) {
    if (!canInsert || !entityType || entityId == null) return;
    const editor = editorRef.current;
    if (!editor) return;
    for (const original of files) {
      try {
        const file = await preparePictureFile(original);
        const created = (await uploadAttachmentFor(entityType, entityId, file, { inlineImage: true })) as { id: number };
        const local = URL.createObjectURL(file);
        rememberPictureUrl(created.id, local);
        insertPicture(editor, { kind: "picture", id: created.id, width: 280, caption: "" }, atSelection, () => commit(serialize(editor)), caret.current);
        atSelection = false;
      } catch (err) {
        const message = err instanceof Error && err.message.startsWith("Picture") ? err.message : await extractErrorMessageAsync(err, "Couldn't add that picture.");
        toast.error(message);
      }
    }
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    if (readOnly) return;
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      event.preventDefault();
      const file = imageItem.getAsFile();
      if (file) void addFiles([file], true);
      return;
    }
    const text = event.clipboardData?.getData("text/plain");
    if (text) {
      event.preventDefault();
      insertPlainText(text);
      const editor = editorRef.current;
      if (editor) commit(serialize(editor));
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    const images = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name));
    if (images.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void addFiles(images, true);
  }

  return (
    <div
      className={`relative min-w-0 ${frameClassName ?? ""}`}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      <div
        ref={editorRef}
        className={`aq-picture-field ${className ?? ""}`}
        contentEditable={!readOnly}
        role="textbox"
        aria-multiline="true"
        aria-readonly={readOnly}
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        style={{ minHeight: `${Math.max(rows, 2) * 1.35}em` }}
        onInput={(event: FormEvent<HTMLDivElement>) => {
          if ((event.target as HTMLElement).closest?.("[data-picture-id]")) return;
          const editor = editorRef.current;
          if (editor) commit(serialize(editor));
        }}
        onPaste={onPaste}
        onBlur={onBlur}
        onKeyUp={rememberCaret}
        onMouseUp={rememberCaret}
      />
      {canInsert && (
        <button
          type="button"
          className="aq-picture-insert no-print"
          onMouseDown={(event) => {
            event.preventDefault();
            rememberCaret();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            fileRef.current?.click();
          }}
        >
          Insert Picture
        </button>
      )}
      {canInsert &&
        typeof document !== "undefined" &&
        createPortal(
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            style={{ display: "none" }}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void addFiles(files, true);
            }}
          />,
          document.body,
        )}
    </div>
  );
}

function insertPlainText(text: string) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertPicture(
  editor: HTMLElement,
  part: Extract<PicturePart, { kind: "picture" }>,
  atSelection: boolean,
  onEdit: () => void,
  saved: Range | null,
) {
  const figure = buildFigure(part, false, onEdit);
  const selection = window.getSelection();
  const live = selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode) ? selection.getRangeAt(0) : null;
  const range = atSelection ? live ?? (saved && editor.contains(saved.startContainer) ? saved : null) : null;
  if (range) {
    range.deleteContents();
    range.insertNode(figure);
    range.setStartAfter(figure);
    range.collapse(true);
    const next = window.getSelection();
    next?.removeAllRanges();
    next?.addRange(range);
  } else {
    editor.append(figure);
  }
}

function paint(editor: HTMLElement, value: string, readOnly: boolean, onEdit: () => void) {
  editor.replaceChildren();
  for (const part of parsePictureText(value)) {
    if (part.kind === "text") {
      const lines = part.text.split("\n");
      lines.forEach((line, index) => {
        if (index > 0) editor.append(document.createElement("br"));
        if (line) editor.append(document.createTextNode(line));
      });
    } else {
      editor.append(buildFigure(part, readOnly, onEdit));
    }
  }
}

function buildFigure(part: Extract<PicturePart, { kind: "picture" }>, readOnly: boolean, onEdit: () => void): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "aq-picture";
  figure.contentEditable = "false";
  figure.dataset.pictureId = String(part.id);
  if (part.width) figure.dataset.pictureWidth = String(part.width);
  figure.dataset.pictureCaption = part.caption;
  if (part.width) figure.style.width = `${part.width}px`;

  const image = document.createElement("img");
  image.alt = part.caption || "Picture";
  void pictureObjectUrl(part.id)
    .then((url) => {
      const src = pictureSrc(url);
      if (image.isConnected && src) image.src = src;
    })
    .catch(() => {
      image.alt = "Picture unavailable";
    });
  figure.append(image);

  if (readOnly) {
    if (part.caption) {
      const caption = document.createElement("figcaption");
      caption.textContent = part.caption;
      figure.append(caption);
    }
  } else {
    const caption = document.createElement("input");
    caption.type = "text";
    caption.value = part.caption;
    caption.placeholder = "Caption";
    caption.className = "aq-picture-caption";
    caption.addEventListener("input", () => {
      figure.dataset.pictureCaption = caption.value;
      image.alt = caption.value || "Picture";
      onEdit();
    });
    figure.append(caption);

    const handle = document.createElement("span");
    handle.className = "aq-picture-handle aq-picture-tools no-print";
    handle.title = "Drag to resize";
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startW = figure.getBoundingClientRect().width;
      const move = (ev: PointerEvent) => {
        const next = Math.max(80, Math.round(startW + ev.clientX - startX));
        figure.style.width = `${next}px`;
        figure.dataset.pictureWidth = String(next);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        onEdit();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    figure.append(handle);
  }

  return figure;
}

/**
 * A comments box that used to save when it lost focus. Typing still saves
 * on blur. Adding, captioning, or resizing a picture saves immediately,
 * because that change has to stay with the record.
 */
export function PictureBoundText({
  saved,
  onSave,
  onPendingChange,
  commitRef,
  entityType,
  entityId,
  className,
  rows = 3,
  readOnly = false,
  allowInsert = true,
  placeholder,
}: {
  saved: string;
  onSave: (value: string) => void;
  /** The current text when it differs from the saved value, or null once it matches again. */
  onPendingChange?: (value: string | null) => void;
  /** Header Save calls this so the latest draft is stored even if blur has not run. */
  commitRef?: { current: (() => void) | null };
  entityType: string;
  entityId: number;
  className?: string;
  rows?: number;
  readOnly?: boolean;
  allowInsert?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState(saved);
  const savedRef = useRef(saved);
  const valueRef = useRef(saved);
  const previousSaved = useRef(saved);
  savedRef.current = saved;
  if (commitRef) {
    commitRef.current = () => {
      if (valueRef.current !== savedRef.current) onSave(valueRef.current);
    };
  }

  useEffect(() => {
    const caughtUp = !textStillDirty(saved, valueRef.current);
    if (saved !== previousSaved.current) {
      previousSaved.current = saved;
      if (!caughtUp) {
        valueRef.current = saved;
        setValue(saved);
        // The draft was just replaced by the new saved value, so nothing is
        // pending anymore — report it, or the unsaved indicator sticks.
        onPendingChange?.(null);
      }
    }
    if (caughtUp || readOnly) onPendingChange?.(null);
  }, [saved, readOnly]);

  return (
    <PictureText
      value={value}
      readOnly={readOnly}
      placeholder={placeholder}
      entityType={entityType}
      entityId={entityId}
      allowInsert={allowInsert}
      className={className}
      rows={rows}
      onChange={(next) => {
        valueRef.current = next;
        setValue(next);
        onPendingChange?.(textStillDirty(savedRef.current, next) ? next : null);
        if (next !== savedRef.current && next.includes("[[aq-picture")) onSave(next);
      }}
      onBlur={() => {
        if (textStillDirty(savedRef.current, valueRef.current)) onSave(valueRef.current);
        else onPendingChange?.(null);
      }}
    />
  );
}

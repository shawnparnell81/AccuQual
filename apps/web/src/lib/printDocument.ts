/** Outcome of handing a PDF to the browser. A dialog or a saved file is success. */
export type PrintPresentResult = "dialog" | "download" | "failed";

export const PRINT_NOT_DOCUMENT = "AccuQual did not return a printable document.";
export const PRINT_SAVE_FAILED = "The print dialog could not be opened, and the document could not be saved.";
export const PRINT_PREPARE_FAILED = "Couldn't prepare this document for printing.";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/** True when the bytes start with a PDF header. An HTML error body is not a document. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

/** A toast is only for a real failure. Opening the dialog, or saving the file, is not one. */
export function printShouldToast(result: PrintPresentResult): boolean {
  return result === "failed";
}

const FRAME_STYLE = [
  "position:fixed",
  "left:0",
  "top:0",
  "width:8.5in",
  "height:11in",
  "opacity:0",
  "border:0",
  "pointer-events:none",
  "z-index:-1",
].join(";");

function releaseLater(url: string, frame: HTMLIFrameElement, delayMs: number) {
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    frame.remove();
  }, delayMs);
}

function saveDownload(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Open the browser print dialog for a PDF we already fetched.
 * The object URL stays alive until afterprint (or a long fallback). Revoking
 * it in the same turn makes the viewer fail after the dialog has already opened.
 * A cross-origin PDF plugin that refuses print() falls back to a download.
 * Either path is success. This throws only when the bytes are not a PDF, or
 * when both the dialog and the download fail.
 */
export async function presentPdf(bytes: Uint8Array, filename: string): Promise<Exclude<PrintPresentResult, "failed">> {
  if (!isPdfBytes(bytes)) {
    throw new Error(PRINT_NOT_DOCUMENT);
  }

  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.title = filename;
  frame.setAttribute("style", FRAME_STYLE);
  document.body.appendChild(frame);

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    frame.addEventListener("load", done, { once: true });
    window.setTimeout(done, 1500);
  });
  await new Promise((resolve) => window.setTimeout(resolve, 450));

  try {
    const win = frame.contentWindow;
    if (!win) throw new Error("print frame unavailable");
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
      frame.remove();
    };
    try {
      win.addEventListener("afterprint", () => window.setTimeout(release, 1500), { once: true });
    } catch {
      // A PDF plugin frame can refuse the listener. print() may still open the dialog.
    }
    window.setTimeout(release, 60000);
    win.focus();
    win.print();
    return "dialog";
  } catch {
    try {
      saveDownload(url, filename);
      releaseLater(url, frame, 60000);
      return "download";
    } catch {
      URL.revokeObjectURL(url);
      frame.remove();
      throw new Error(PRINT_SAVE_FAILED);
    }
  }
}

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogBehavior } from "../shared/useDialogBehavior";
import { LABEL_SIZES, labelPrintCss, labelSizeById, type LabelSizeId } from "../../lib/labelSizes";
import { LabelCard, type BarcodeKind, type LabelContent } from "./LabelCard";

/** Labels on screen before printing: this many, then a count of the rest. Every label still prints. */
const PREVIEW_LIMIT = 12;
const PREVIEW_WIDTH_PX = 300;

/**
 * Preview and print for a sheet of labels. Printing uses the browser print dialog and the printer's normal driver, one label
 * per page at exactly the chosen size. `controls` is where the caller puts what picks the labels (for example which samples).
 * `beforePrint` runs first (the server notes the print and writes the audit entry); if it fails, nothing is printed.
 */
export function LabelPrintDialog({
  title,
  labels,
  defaultSize,
  controls,
  disabledReason,
  beforePrint,
  onClose,
}: {
  title: string;
  labels: LabelContent[];
  defaultSize: LabelSizeId;
  controls?: ReactNode;
  /** When set, printing is off and this says why (for example a selection that is not valid). */
  disabledReason?: string | null;
  beforePrint: (size: LabelSizeId) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useDialogBehavior(true, onClose);
  const [sizeId, setSizeId] = useState<LabelSizeId>(defaultSize);
  const [kind, setKind] = useState<BarcodeKind>("code128");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const size = labelSizeById(sizeId);
  const shown = labels.slice(0, PREVIEW_LIMIT);
  const zoom = Math.min(1, PREVIEW_WIDTH_PX / (size.widthIn * 96));

  // The sheet that actually prints lives outside the app's own markup, so nothing else can print with it.
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const node = document.createElement("div");
    node.className = "aq-label-print-root";
    document.body.appendChild(node);
    setRoot(node);
    return () => {
      node.remove();
    };
  }, []);

  const css = useMemo(() => labelPrintCss(size), [size]);

  async function print() {
    setBusy(true);
    setError(null);
    try {
      await beforePrint(sizeId);
      // Let the sheet finish drawing (QR codes) before the print dialog opens.
      await new Promise((resolve) => setTimeout(resolve, 150));
      window.print();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The labels couldn't be printed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <style>{css}</style>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="label-print-title"
        tabIndex={-1}
        className="modal-in fixed left-1/2 top-12 z-50 flex max-h-[88vh] w-full max-w-2xl -translate-x-1/2 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-4 text-foreground shadow-xl outline-none"
      >
        <h2 id="label-print-title" className="text-base font-semibold">
          {title}
        </h2>
        {controls}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Label size
            <select id="label-size" value={sizeId} onChange={(e) => setSizeId(e.target.value as LabelSizeId)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              {LABEL_SIZES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Barcode
            <select id="label-kind" value={kind} onChange={(e) => setKind(e.target.value as BarcodeKind)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              <option value="code128">Code 128 barcode</option>
              <option value="qr">QR code</option>
            </select>
          </label>
          <p className="pb-2 text-xs text-muted-foreground">Prints one label per page through the printer's normal Windows driver. In the print window choose your label printer and set margins to None.</p>
        </div>

        <section aria-label="Print preview">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Preview: {labels.length} label{labels.length === 1 ? "" : "s"} at {size.label}
          </p>
          {labels.length === 0 ? (
            <p className="text-sm text-muted-foreground">{disabledReason ?? "No labels to print."}</p>
          ) : (
            <div className="flex flex-wrap gap-3 rounded-md bg-muted p-3">
              {shown.map((content) => (
                <div key={content.code} style={{ width: size.widthIn * 96 * zoom, height: size.heightIn * 96 * zoom }} className="shadow-sm">
                  <div style={{ width: `${size.widthIn}in`, height: `${size.heightIn}in`, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                    <LabelCard size={size} kind={kind} content={content} />
                  </div>
                </div>
              ))}
              {labels.length > shown.length && <p className="self-center text-sm text-muted-foreground">and {labels.length - shown.length} more</p>}
            </div>
          )}
        </section>

        {(error || (disabledReason && labels.length > 0)) && <p className="text-sm text-destructive">{error ?? disabledReason}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
            disabled={busy || labels.length === 0 || Boolean(disabledReason)}
            onClick={() => void print()}
          >
            {busy ? "Preparing…" : `Print ${labels.length} label${labels.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
      {root &&
        createPortal(
          labels.map((content) => <LabelCard key={content.code} size={size} kind={kind} content={content} />),
          root,
        )}
    </>
  );
}

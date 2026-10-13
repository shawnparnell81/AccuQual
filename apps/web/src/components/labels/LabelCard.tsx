import { useEffect, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import { code128Bars } from "../../lib/code128";
import type { LabelSize } from "../../lib/labelSizes";

export type BarcodeKind = "code128" | "qr";

/** What one label shows. The company name comes from Settings, never from the code. */
export interface LabelContent {
  /** What the barcode holds and a scanner types: for a sample tag, <FAI number>-S<n>. */
  code: string;
  partNumber: string;
  lotReference: string;
  /** "Sample 3 of 5". Left out for a label that is not a sample tag. */
  sampleNumber?: number;
  sampleCount?: number;
  faiNumber: string;
  date: string;
  companyName: string;
}

/** Quiet zone either side of a Code 128 barcode, in modules. */
const QUIET = 10;

export function Code128Barcode({ value, height }: { value: string; height: string }) {
  const { bars, modules } = code128Bars(value);
  const total = modules + QUIET * 2;
  return (
    <svg
      role="img"
      aria-label={`Barcode ${value}`}
      viewBox={`0 0 ${total} 1`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      style={{ display: "block", width: "100%", height }}
    >
      <rect x={0} y={0} width={total} height={1} fill="#ffffff" />
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x + QUIET} y={0} width={bar.width} height={1} fill="#000000" />
      ))}
    </svg>
  );
}

function QrCode({ value, sizeIn }: { value: string; sizeIn: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Drawn at four times the printed size so it stays sharp on a 203 dpi printer.
    QRCode.toDataURL(value, { margin: 0, width: Math.round(sizeIn * 96 * 4), errorCorrectionLevel: "M" }).then((next) => {
      if (!cancelled) setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [value, sizeIn]);
  const box: CSSProperties = { width: `${sizeIn}in`, height: `${sizeIn}in`, flex: "none" };
  return url ? <img src={url} alt={`QR code for ${value}`} style={{ ...box, imageRendering: "pixelated" }} /> : <div style={box} />;
}

/**
 * One label, laid out for its size. All measurements are in inches so the printed label matches the size chosen, and the
 * type scales with the label. Black on white whatever the app theme, because it goes to a thermal printer. The barcode takes
 * whatever height the words leave, so the sample line is never pushed off a small label.
 */
export function LabelCard({ size, kind, content }: { size: LabelSize; kind: BarcodeKind; content: LabelContent }) {
  const scale = Math.min(size.widthIn / 2, size.heightIn);
  const pt = (base: number) => `${(base * scale).toFixed(2)}pt`;
  const pad = 0.06 * scale;
  const lot = content.lotReference ? `Lot/PO ${content.lotReference}` : "";
  const sample = content.sampleNumber != null ? `Sample ${content.sampleNumber}${content.sampleCount ? ` of ${content.sampleCount}` : ""}` : "";
  const text: CSSProperties = { margin: 0, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const maxBarcodeIn = 1.4;

  return (
    <div
      className="aq-label-page"
      style={{
        width: `${size.widthIn}in`,
        height: `${size.heightIn}in`,
        padding: `${pad}in`,
        boxSizing: "border-box",
        background: "#ffffff",
        color: "#000000",
        fontFamily: "Arial, Helvetica, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: `${0.02 * scale}in`,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.05in", fontSize: pt(6) }}>
        <p style={{ ...text, fontWeight: 700, minWidth: 0 }}>{content.companyName}</p>
        <p style={{ ...text, flex: "none" }}>{content.date}</p>
      </div>

      {kind === "qr" ? (
        <div style={{ display: "flex", alignItems: "center", gap: `${0.08 * scale}in`, minHeight: 0, flex: 1 }}>
          <QrCode value={content.code} sizeIn={Math.min(size.heightIn * 0.55, size.widthIn * 0.4)} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ ...text, fontSize: pt(9), fontWeight: 700 }}>{content.partNumber}</p>
            {lot && <p style={{ ...text, fontSize: pt(6.5) }}>{lot}</p>}
            {sample && <p style={{ ...text, fontSize: pt(8.5), fontWeight: 700 }}>{sample}</p>}
            <p style={{ ...text, fontSize: pt(6.5) }}>{content.faiNumber}</p>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.05in" }}>
            <p style={{ ...text, fontSize: pt(9.5), fontWeight: 700, minWidth: 0 }}>{content.partNumber}</p>
            {sample && <p style={{ ...text, fontSize: pt(8.5), fontWeight: 700, flex: "none" }}>{sample}</p>}
          </div>
          <p style={{ ...text, fontSize: pt(6.5) }}>{[lot, content.faiNumber].filter(Boolean).join("  ·  ")}</p>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ flex: 1, minHeight: 0, maxHeight: `${maxBarcodeIn}in` }}>
              <Code128Barcode value={content.code} height="100%" />
            </div>
          </div>
        </>
      )}
      <p style={{ ...text, fontSize: pt(6.5), textAlign: "center", letterSpacing: "0.04em" }}>{content.code}</p>
    </div>
  );
}

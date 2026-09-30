import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, type PDFImage, type PDFPage } from "pdf-lib";

let cached: Uint8Array | null = null;

function logoBytes(): Uint8Array {
  if (!cached) {
    const here = dirname(fileURLToPath(import.meta.url));
    cached = new Uint8Array(readFileSync(join(here, "../../../assets/dma-logo.png")));
  }
  return cached;
}

export async function embedDmaLogo(doc: PDFDocument): Promise<PDFImage> {
  return doc.embedPng(logoBytes());
}

/**
 * Official mark on a black plate. `yTop` is the top edge in PDF coordinates.
 * Returns the plate width so the title can sit beside it.
 */
export function drawDmaLogo(page: PDFPage, image: PDFImage, x: number, yTop: number, height: number): number {
  const pad = 1.5;
  const innerH = Math.max(1, height - pad * 2);
  const innerW = innerH * (image.width / image.height);
  const plateW = innerW + pad * 2;
  page.drawRectangle({ x, y: yTop - height, width: plateW, height, color: rgb(0, 0, 0) });
  page.drawImage(image, { x: x + pad, y: yTop - height + pad, width: innerW, height: innerH });
  return plateW;
}

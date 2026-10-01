import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, type PDFImage, type PDFPage } from "pdf-lib";

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
 * Official mark at the requested height. `yTop` is the top edge in PDF coordinates.
 * The file is the dark navy artwork, so it sits on the white page.
 * Returns the drawn width so the title can sit beside it.
 */
export function drawDmaLogo(page: PDFPage, image: PDFImage, x: number, yTop: number, height: number): number {
  const drawnH = Math.max(1, height);
  const drawnW = drawnH * (image.width / image.height);
  page.drawImage(image, { x, y: yTop - drawnH, width: drawnW, height: drawnH });
  return drawnW;
}

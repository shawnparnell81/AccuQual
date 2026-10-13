import { inflateSync } from "node:zlib";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

/** Every drawn text string in a PDF made by pdf-lib (hex strings in Tj operators of Flate content streams), joined by spaces. */
export async function pdfDrawnText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const filter = object.dict.get(PDFName.of("Filter"));
    let data = Buffer.from(object.contents);
    if (filter && String(filter) === "/FlateDecode") {
      try {
        data = inflateSync(data);
      } catch {
        continue;
      }
    }
    const text = data.toString("latin1");
    for (const match of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(match[1]!, "hex").toString("latin1"));
    for (const match of text.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) out.push(match[1]!);
  }
  return out.join(" ");
}

/** How many pictures the PDF holds: image XObjects, not counting the soft-mask image that carries a PNG's transparency. */
export async function pdfImageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  const images: { ref: string; dict: PDFDict }[] = [];
  const masks = new Set<string>();
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : null;
    if (!dict) continue;
    const subtype = dict.get(PDFName.of("Subtype"));
    if (!subtype || String(subtype) !== "/Image") continue;
    images.push({ ref: ref.toString(), dict });
    const mask = dict.get(PDFName.of("SMask"));
    if (mask) masks.add(String(mask));
  }
  return images.filter((image) => !masks.has(image.ref)).length;
}

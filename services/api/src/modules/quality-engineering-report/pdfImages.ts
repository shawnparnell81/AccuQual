import { rgb } from "pdf-lib";
import { MARGIN, ensureSpace, wrapText, type RenderContext } from "../forms/schema-pdf-renderer.js";
import type { ReportImageFile } from "./reportImages.js";

const TEXT_DARK = rgb(0.13, 0.13, 0.15);
const CAPTION_SIZE = 8.5;
const CAPTION_LEADING = 11;
const GAP = 8;

/** The section the Images block closes out when a picture has no section of its own in this report. */
export const UNMATCHED_SECTION = "__unmatched__";

/** Pictures whose Word heading matches `sectionKey` (or, for UNMATCHED_SECTION, matches no section here). */
export function imagesForSection(files: ReportImageFile[], sectionKey: string, knownKeys: Set<string>): ReportImageFile[] {
  if (sectionKey === UNMATCHED_SECTION) return files.filter((file) => !file.image.sectionKey || !knownKeys.has(file.image.sectionKey));
  return files.filter((file) => file.image.sectionKey === sectionKey);
}

/**
 * Draws pictures one under another, each scaled to the page width (smaller if it would not fit a page
 * tall), aspect ratio kept, with its caption below. PNG and JPEG are embedded; GIF and WEBP cannot be
 * placed in a PDF, so those get a line naming the file instead of a silent gap.
 */
export async function drawReportImages(ctx: RenderContext, files: ReportImageFile[]): Promise<void> {
  const width = ctx.page.getWidth() - MARGIN * 2;
  for (const file of files) {
    const caption = file.image.caption.trim();
    const captionLines = caption ? wrapText(caption, ctx.italic, CAPTION_SIZE, width) : [];
    const captionHeight = captionLines.length * CAPTION_LEADING;
    const embedded = file.mimeType === "image/png" ? await ctx.doc.embedPng(file.bytes) : file.mimeType === "image/jpeg" ? await ctx.doc.embedJpg(file.bytes) : null;
    if (!embedded) {
      ensureSpace(ctx, 14 + captionHeight + GAP);
      ctx.page.drawText(`Picture ${file.image.fileName} is a ${file.mimeType.replace("image/", "").toUpperCase()} image and is not shown in the PDF.`, { x: MARGIN, y: ctx.y - 10, size: 8.5, font: ctx.italic, color: TEXT_DARK });
      ctx.y -= 14;
    } else {
      const pageHeight = ctx.page.getHeight();
      const maxHeight = pageHeight - MARGIN * 2 - 90 - captionHeight;
      const scale = Math.min(width / embedded.width, maxHeight / embedded.height);
      const drawWidth = embedded.width * scale;
      const drawHeight = embedded.height * scale;
      ensureSpace(ctx, drawHeight + captionHeight + GAP);
      ctx.page.drawImage(embedded, { x: MARGIN, y: ctx.y - drawHeight, width: drawWidth, height: drawHeight });
      ctx.y -= drawHeight;
    }
    captionLines.forEach((line, index) => {
      ctx.page.drawText(line, { x: MARGIN, y: ctx.y - 9 - index * CAPTION_LEADING, size: CAPTION_SIZE, font: ctx.italic, color: TEXT_DARK });
    });
    ctx.y -= captionHeight + GAP;
  }
}

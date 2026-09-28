import { AppError } from "../../utils/appError.js";

/**
 * Inline form pictures are normal attachments. This only refuses a file
 * that is not a PNG, JPG, GIF, or WebP, or that is over 5 MB. The bytes
 * are still written by the existing upload handler.
 *
 * Marker format matches apps/web/src/components/forms/pictureText.ts.
 */

export const INLINE_PICTURE_MAX_BYTES = 5 * 1024 * 1024;

export const INLINE_PICTURE_ERROR = "Pictures must be a PNG, JPG, GIF, or WebP image, 5 MB or smaller.";

const TOKEN = /\[\[aq-picture\|id=(\d+)(?:\|w=(\d+))?(?:\|c=([^\]]*))?\]\]/g;

export function inlinePictureMime(buf: Buffer): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null {
  if (buf.length >= 4 && buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 4 && buf.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export function assertInlinePicture(buf: Buffer, size: number): string {
  if (size > INLINE_PICTURE_MAX_BYTES || buf.length > INLINE_PICTURE_MAX_BYTES) {
    throw AppError.badRequest(INLINE_PICTURE_ERROR);
  }
  const mime = inlinePictureMime(buf);
  if (!mime) throw AppError.badRequest(INLINE_PICTURE_ERROR);
  return mime;
}

function decodeCaption(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Printed PDF text keeps the words. A picture is named by its caption. */
export function pictureTextToPlain(value: string): string {
  return value.replace(TOKEN, (_match, _id, _width, caption: string | undefined) => {
    const text = caption ? decodeCaption(caption) : "";
    return text ? `[Picture: ${text}]` : "[Picture]";
  });
}

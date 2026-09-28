/**
 * Pictures inside a form field are stored in the field's existing string.
 * Plain text is left untouched. A picture is a marker the field renders
 * inline; the file itself is a normal attachment.
 *
 * Keep the marker format in sync with services/api inlinePicture.ts.
 */

export const INLINE_PICTURE_MAX_BYTES = 5 * 1024 * 1024;

export const INLINE_PICTURE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

const TOKEN = /\[\[aq-picture\|id=(\d+)(?:\|w=(\d+))?(?:\|c=([^\]]*))?\]\]/g;

export type PicturePart =
  | { kind: "text"; text: string }
  | { kind: "picture"; id: number; width?: number; caption: string };

function decodeCaption(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function formatPictureToken(id: number, width?: number, caption?: string): string {
  let token = `[[aq-picture|id=${id}`;
  if (width && width > 0) token += `|w=${Math.round(width)}`;
  if (caption) token += `|c=${encodeURIComponent(caption)}`;
  return `${token}]]`;
}

export function parsePictureText(value: string): PicturePart[] {
  if (!value) return [{ kind: "text", text: "" }];
  const parts: PicturePart[] = [];
  let last = 0;
  for (const match of value.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: "text", text: value.slice(last, index) });
    const picture: PicturePart = {
      kind: "picture",
      id: Number(match[1]),
      caption: match[3] ? decodeCaption(match[3]) : "",
    };
    if (match[2]) picture.width = Number(match[2]);
    parts.push(picture);
    last = index + match[0].length;
  }
  if (last < value.length) parts.push({ kind: "text", text: value.slice(last) });
  if (parts.length === 0) parts.push({ kind: "text", text: value });
  return parts;
}

/** Existing words stay. A picture becomes its caption, or the word Picture. */
export function pictureTextToPlain(value: string): string {
  return value.replace(TOKEN, (_match, _id, _width, caption: string | undefined) => {
    const text = caption ? decodeCaption(caption) : "";
    return text ? `[Picture: ${text}]` : "[Picture]";
  });
}

export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export async function preparePictureFile(file: File): Promise<File> {
  if (file.size <= 0) throw new Error("That picture is empty.");
  if (file.size > INLINE_PICTURE_MAX_BYTES) throw new Error("Pictures must be 5 MB or smaller.");
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageMime(head);
  const claimed = (INLINE_PICTURE_TYPES as readonly string[]).includes(file.type) ? file.type : "";
  const type = sniffed ?? claimed;
  if (!(INLINE_PICTURE_TYPES as readonly string[]).includes(type)) {
    throw new Error("Pictures must be PNG, JPG, GIF, or WebP.");
  }
  const ext = type === "image/jpeg" ? "jpg" : type.slice("image/".length);
  const name = /\.(png|jpe?g|gif|webp)$/i.test(file.name) ? file.name : `picture.${ext}`;
  if (file.type === type && file.name === name) return file;
  return new File([file], name, { type });
}

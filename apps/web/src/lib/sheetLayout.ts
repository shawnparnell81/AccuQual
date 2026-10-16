/**
 * Reads a form sheet as it is drawn on screen so the API can print the same layout: every box with its
 * background and each border side, every line of text at its place and font, typed values, ticks, logos,
 * signatures and charts. Sizes are CSS pixels from the sheet's top-left corner.
 *
 * The capture is taken in the light theme, and anything marked print:hidden, no-print or data-pdf-skip is left
 * out, the same parts Print leaves out.
 */

export interface BorderSide {
  w: number;
  c: string;
  s: string;
}

export interface SheetBox {
  x: number;
  y: number;
  w: number;
  h: number;
  bg?: string;
  /** top, right, bottom, left */
  b?: [BorderSide | null, BorderSide | null, BorderSide | null, BorderSide | null];
}

export interface SheetText {
  x: number;
  y: number;
  w: number;
  h: number;
  t: string;
  size: number;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  serif: boolean;
  color: string;
  underline: boolean;
  /** Typed into a box: wrap inside w. */
  wrap?: boolean;
  align?: "left" | "center" | "right";
}

export interface SheetImage {
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
}

export interface SheetTick {
  x: number;
  y: number;
  w: number;
  h: number;
  on: boolean;
  round: boolean;
}

export interface SheetLayout {
  version: 1;
  width: number;
  height: number;
  boxes: SheetBox[];
  texts: SheetText[];
  images: SheetImage[];
  ticks: SheetTick[];
  /** Values in the form's own fields. The API checks them against the saved record. */
  values: string[];
  /** Places a page may end: the bottom of each table row and block. */
  breaks: number[];
}

const MAX_ITEMS = 60_000;

function hidden(el: Element, style: CSSStyleDeclaration): boolean {
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return true;
  if (el.hasAttribute("data-pdf-skip")) return true;
  const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : el.getAttribute("class") ?? "";
  return /(^|\s)(print:hidden|no-print)(\s|$)/.test(cls);
}

function visibleColor(color: string): boolean {
  if (!color || color === "transparent") return false;
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return true;
  const parts = m[1]!.split(/[ ,/]+/).filter(Boolean);
  return parts.length < 4 || Number(parts[3]) > 0.02;
}

function side(style: CSSStyleDeclaration, name: "Top" | "Right" | "Bottom" | "Left"): BorderSide | null {
  const w = parseFloat(style.getPropertyValue(`border-${name.toLowerCase()}-width`)) || 0;
  const s = style.getPropertyValue(`border-${name.toLowerCase()}-style`);
  const c = style.getPropertyValue(`border-${name.toLowerCase()}-color`);
  if (w <= 0 || s === "none" || s === "hidden" || !visibleColor(c)) return null;
  return { w: round(w), c, s };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function fontOf(style: CSSStyleDeclaration) {
  const family = style.fontFamily.toLowerCase();
  return {
    size: round(parseFloat(style.fontSize) || 12),
    bold: (parseInt(style.fontWeight, 10) || 400) >= 600,
    italic: style.fontStyle === "italic" || style.fontStyle === "oblique",
    mono: /mono|courier|consolas/.test(family),
    serif: /(^|[\s,"'])(serif|times|georgia|cambria)/.test(family) && !/sans/.test(family),
    color: style.color,
    underline: style.textDecorationLine.includes("underline"),
  };
}

async function imageData(el: HTMLImageElement | HTMLCanvasElement | SVGSVGElement, w: number, h: number): Promise<string | null> {
  try {
    if (el instanceof HTMLCanvasElement) return el.toDataURL("image/png");
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    let img: HTMLImageElement;
    if (el instanceof HTMLImageElement) {
      if (el.src.startsWith("data:image/png") || el.src.startsWith("data:image/jpeg")) return el.src;
      img = el;
      if (!img.complete) await img.decode().catch(() => undefined);
    } else {
      const copy = el.cloneNode(true) as SVGSVGElement;
      copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      copy.setAttribute("width", String(w));
      copy.setAttribute("height", String(h));
      inlineSvgStyles(el, copy);
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
      img = new Image();
      img.src = url;
      await img.decode();
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** A chart's SVG takes its colors from CSS. Copy the drawn ones onto the copy so the picture keeps them. */
function inlineSvgStyles(source: Element, copy: Element) {
  const from = [source, ...source.querySelectorAll("*")];
  const to = [copy, ...copy.querySelectorAll("*")];
  from.forEach((node, index) => {
    const target = to[index] as SVGElement | undefined;
    if (!target) return;
    const style = getComputedStyle(node);
    for (const prop of ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-size", "font-family", "font-weight"]) {
      const value = style.getPropertyValue(prop);
      if (value) target.style.setProperty(prop, value);
    }
  });
}

function textRuns(node: Text, origin: DOMRect, style: CSSStyleDeclaration, out: SheetText[]) {
  const text = node.data;
  if (!text.trim()) return;
  const range = document.createRange();
  const font = fontOf(style);
  let run: { x: number; y: number; r: number; h: number; t: string } | null = null;
  const flush = () => {
    if (run && run.t.trim()) out.push({ x: round(run.x), y: round(run.y), w: round(run.r - run.x), h: round(run.h), t: run.t.replace(/\s+/g, " ").trim(), ...font });
    run = null;
  };
  const words = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = words.exec(text))) {
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
    for (const [i, r] of rects.entries()) {
      const piece = rects.length === 1 ? m[0] : i === 0 ? m[0] : "";
      const x = r.left - origin.left;
      const y = r.top - origin.top;
      if (run && Math.abs(run.y - y) < 2 && x >= run.r - 1) {
        run.t += ` ${piece}`;
        run.r = r.right - origin.left;
        run.h = Math.max(run.h, r.height);
      } else {
        flush();
        run = { x, y, r: r.right - origin.left, h: r.height, t: piece };
      }
    }
  }
  flush();
}

function fieldText(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text ?? "";
  if (el instanceof HTMLInputElement && el.type === "password") return "";
  return el.value;
}

/** Turns the light theme on while the sheet is read, then puts the person's theme back. */
function withLightTheme<T>(read: () => T): T {
  const root = document.documentElement;
  const dark = root.classList.contains("dark");
  if (dark) root.classList.remove("dark");
  try {
    return read();
  } finally {
    if (dark) root.classList.add("dark");
  }
}

interface PendingPicture {
  el: HTMLImageElement | HTMLCanvasElement | SVGSVGElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The sheet the Download PDF button prints: the page's [data-pdf-sheet] element. */
export function findPdfSheet(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-pdf-sheet]");
}

export async function captureSheetLayout(root: HTMLElement): Promise<SheetLayout> {
  const pictures: PendingPicture[] = [];
  const layout = withLightTheme(() => {
    const origin = root.getBoundingClientRect();
    const out: SheetLayout = { version: 1, width: round(origin.width), height: round(origin.height), boxes: [], texts: [], images: [], ticks: [], values: [], breaks: [] };
    const walk = (el: Element) => {
      if (out.boxes.length + out.texts.length > MAX_ITEMS) return;
      const style = getComputedStyle(el);
      if (hidden(el, style)) return;
      const r = el.getBoundingClientRect();
      const x = round(r.left - origin.left);
      const y = round(r.top - origin.top);
      const w = round(r.width);
      const h = round(r.height);
      if (w > 0 && h > 0) {
        const bg = visibleColor(style.backgroundColor) ? style.backgroundColor : undefined;
        const b: SheetBox["b"] = [side(style, "Top"), side(style, "Right"), side(style, "Bottom"), side(style, "Left")];
        const hasBorder = b.some(Boolean);
        if (bg || hasBorder) out.boxes.push({ x, y, w, h, ...(bg ? { bg } : {}), ...(hasBorder ? { b } : {}) });
      }
      const tag = el.tagName;
      if (tag === "TR" || el.hasAttribute("data-pdf-break")) out.breaks.push(round(y + h));
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        out.ticks.push({ x, y, w, h, on: el.checked, round: el.type === "radio" });
        if (el.checked) out.values.push(el.value === "on" ? "true" : el.value);
        return;
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        if (el instanceof HTMLInputElement && ["hidden", "file", "button", "submit"].includes(el.type)) return;
        const shown = fieldText(el);
        if (!el.hasAttribute("data-pdf-computed")) {
          const raw = el instanceof HTMLSelectElement ? el.value : el.value;
          if (raw.trim()) out.values.push(raw);
        }
        if (shown.trim()) {
          const padL = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0);
          const padR = (parseFloat(style.paddingRight) || 0) + (parseFloat(style.borderRightWidth) || 0);
          const padT = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0);
          const padB = (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0);
          const area = el instanceof HTMLTextAreaElement;
          const align = style.textAlign === "center" ? "center" : style.textAlign === "right" || style.textAlign === "end" ? "right" : "left";
          out.texts.push({
            x: round(x + padL),
            y: round(area ? y + padT : y),
            w: round(Math.max(1, w - padL - padR)),
            h: round(area ? Math.max(1, h - padT - padB) : h),
            t: shown,
            ...fontOf(style),
            wrap: area,
            align,
          });
        }
        return;
      }
      if (el instanceof HTMLImageElement || el instanceof HTMLCanvasElement || el instanceof SVGSVGElement) {
        if (w > 0 && h > 0) pictures.push({ el, x, y, w, h });
        return;
      }
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) textRuns(child as Text, origin, style, out.texts);
        else if (child.nodeType === Node.ELEMENT_NODE) walk(child as Element);
      }
    };
    walk(root);
    out.breaks = [...new Set(out.breaks)].sort((a, b) => a - b);
    return out;
  });
  for (const picture of pictures) {
    const src = await imageData(picture.el, picture.w, picture.h);
    if (src) layout.images.push({ x: picture.x, y: picture.y, w: picture.w, h: picture.h, src });
  }
  return layout;
}

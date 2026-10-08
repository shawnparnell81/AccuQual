/**
 * Word header and footer parts. Text, tables, images, and PAGE / NUMPAGES / DATE
 * fields round-trip. Different-first-page and odd/even are stored on the band.
 * Doc ID and Rev are AccuQual fields (DOCPROPERTY), not Word built-ins.
 */

export interface DocumentBand {
  differentFirstPage: boolean;
  differentOddEven: boolean;
  defaultHtml: string;
  firstHtml: string;
  evenHtml: string;
}

interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<HtmlNode | string>;
}

interface ImageFile {
  name: string;
  data: Buffer;
}

interface ImageBag {
  files: ImageFile[];
  rels: { id: string; target: string }[];
  imageCount: number;
}

const FIELD_LABEL: Record<string, string> = {
  page: "Page number",
  pages: "Page count",
  docId: "Doc ID",
  rev: "Rev",
  date: "Date",
};

const VOID = new Set(["br", "img", "hr"]);

export function htmlHasContent(html: string): boolean {
  const marked = html.replace(/<img\b[^>]*>/gi, "x").replace(/data-doc-field\s*=/gi, "x");
  const text = marked.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 0;
}

export function bandHasContent(band: DocumentBand | null | undefined): boolean {
  if (!band) return false;
  return htmlHasContent(band.defaultHtml) || htmlHasContent(band.firstHtml) || htmlHasContent(band.evenHtml);
}

export function normalizeBand(value: unknown): DocumentBand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const band: DocumentBand = {
    differentFirstPage: record.differentFirstPage === true,
    differentOddEven: record.differentOddEven === true,
    defaultHtml: typeof record.defaultHtml === "string" ? record.defaultHtml : "",
    firstHtml: typeof record.firstHtml === "string" ? record.firstHtml : "",
    evenHtml: typeof record.evenHtml === "string" ? record.evenHtml : "",
  };
  if (!bandHasContent(band) && !band.differentFirstPage && !band.differentOddEven) return null;
  return band;
}

export function cleanBand(value: unknown, sanitize: (html: string) => string): DocumentBand | null {
  const band = normalizeBand(value);
  if (!band) return null;
  band.defaultHtml = sanitize(band.defaultHtml);
  band.firstHtml = sanitize(band.firstHtml);
  band.evenHtml = sanitize(band.evenHtml);
  if (!bandHasContent(band) && !band.differentFirstPage && !band.differentOddEven) return null;
  return band;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(source: string, name: string): string {
  const match = new RegExp(`${name}="([^"]*)"`).exec(source) ?? new RegExp(`${name}='([^']*)'`).exec(source);
  return match?.[1] ?? "";
}

function indexOfTag(xml: string, tag: string, from: number): number {
  const needle = `<${tag}`;
  let index = from;
  while (index < xml.length) {
    const at = xml.indexOf(needle, index);
    if (at < 0) return -1;
    const next = xml[at + needle.length];
    if (next === ">" || next === " " || next === "/" || next === "\n" || next === "\r" || next === "\t") return at;
    index = at + needle.length;
  }
  return -1;
}

function findElement(xml: string, tag: string, from: number): { start: number; end: number; inner: string } | null {
  const start = indexOfTag(xml, tag, from);
  if (start < 0) return null;
  const close = `</${tag}>`;
  const endTag = xml.indexOf(close, start);
  if (endTag < 0) return null;
  const openEnd = xml.indexOf(">", start);
  if (openEnd < 0 || openEnd > endTag) return null;
  return { start, end: endTag + close.length, inner: xml.slice(openEnd + 1, endTag) };
}

function fieldName(instr: string): string | null {
  const text = instr.replace(/\s+/g, " ").trim().toUpperCase();
  if (/\bNUMPAGES\b/.test(text)) return "pages";
  if (/\bPAGE\b/.test(text)) return "page";
  if (/\bDATE\b/.test(text)) return "date";
  if (/ACCUQUALDOCID/.test(text)) return "docId";
  if (/ACCUQUALREV/.test(text)) return "rev";
  return null;
}

function fieldSpan(name: string): string {
  const label = FIELD_LABEL[name];
  if (!label) return "";
  return `<span class="fb-doc-field" data-doc-field="${name}" contenteditable="false">${label}</span>`;
}

function imageHtml(src: string): string {
  return `<img src="${escapeXml(src)}" alt="" />`;
}

function marked(run: string, tag: "b" | "i" | "u"): boolean {
  if (tag === "u") return /<w:u\b/.test(run) && !/w:val="none"/.test(run);
  const pattern = tag === "b" ? /<w:b\b/ : /<w:i\b/;
  const off = tag === "b" ? /<w:b\b[^>]*w:val="0"/ : /<w:i\b[^>]*w:val="0"/;
  return pattern.test(run) && !off.test(run);
}

function wrapText(text: string, run: string): string {
  let inner = escapeHtml(text);
  if (marked(run, "u")) inner = `<u>${inner}</u>`;
  if (marked(run, "i")) inner = `<i>${inner}</i>`;
  if (marked(run, "b")) inner = `<b>${inner}</b>`;
  return inner;
}

function runHtml(run: string, images: Map<string, string>): string {
  let html = "";
  if (/<w:drawing\b|<w:pict\b|<a:blip\b|<v:imagedata\b/.test(run)) {
    const id = attr(run, "r:embed") || attr(run, "r:id");
    const src = id ? images.get(id) : undefined;
    if (src) html += imageHtml(src);
  }
  if (/<w:tab\b|<w:ptab\b/.test(run)) html += "\t";
  if (/<w:br\b/.test(run)) html += "<br />";
  const text = [...run.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => decodeXml(match[1] ?? "")).join("");
  if (text) html += wrapText(text, run);
  return html;
}

function paragraphInner(paragraphXml: string, images: Map<string, string>): string {
  let xml = paragraphXml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "");
  xml = xml.replace(/<\/?w:hyperlink\b[^>]*>/g, "");
  xml = xml.replace(/<w:fldSimple\b([^>]*)>[\s\S]*?<\/w:fldSimple>/g, (_match, attrs: string) => {
    const instr = attr(attrs, "w:instr");
    return `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${escapeXml(decodeXml(instr))}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  });
  const runs = [...xml.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)].map((match) => match[0]);
  let mode: "text" | "instr" | "result" = "text";
  let instr = "";
  let html = "";
  for (const run of runs) {
    const fld = attr(run, "w:fldCharType");
    if (fld === "begin") {
      mode = "instr";
      instr = "";
      continue;
    }
    if (fld === "separate") {
      mode = "result";
      continue;
    }
    if (fld === "end") {
      const name = fieldName(instr);
      if (name) html += fieldSpan(name);
      mode = "text";
      instr = "";
      continue;
    }
    const instrText = [...run.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g)].map((match) => decodeXml(match[1] ?? "")).join("");
    if (instrText) {
      instr += instrText;
      continue;
    }
    if (mode !== "text") continue;
    html += runHtml(run, images);
  }
  return html;
}

function alignOf(paragraphXml: string): string {
  const props = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(paragraphXml)?.[0] ?? "";
  const jc = /<w:jc\b[^>]*\/?>/.exec(props)?.[0] ?? "";
  const align = attr(jc, "w:val");
  if (align === "center" || align === "right") return align;
  if (align === "both") return "justify";
  return "";
}

function paragraphHtml(paragraphXml: string, images: Map<string, string>): string {
  const inner = paragraphInner(paragraphXml, images);
  if (!inner) return "";
  const align = alignOf(paragraphXml);
  const style = align ? ` style="text-align:${align}"` : "";
  return `<p${style}>${inner}</p>`;
}

function blocksHtml(xml: string, images: Map<string, string>): string {
  const out: string[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const paragraphAt = indexOfTag(xml, "w:p", cursor);
    const tableAt = indexOfTag(xml, "w:tbl", cursor);
    if (paragraphAt < 0 && tableAt < 0) break;
    if (tableAt >= 0 && (paragraphAt < 0 || tableAt < paragraphAt)) {
      const table = findElement(xml, "w:tbl", tableAt);
      if (!table) break;
      const html = tableHtml(table.inner, images);
      if (html) out.push(html);
      cursor = table.end;
      continue;
    }
    const paragraph = findElement(xml, "w:p", paragraphAt);
    if (!paragraph) break;
    const html = paragraphHtml(xml.slice(paragraph.start, paragraph.end), images);
    if (html) out.push(html);
    cursor = paragraph.end;
  }
  return out.join("");
}

function tableHtml(inner: string, images: Map<string, string>): string {
  const rows: string[] = [];
  let cursor = 0;
  while (cursor < inner.length) {
    const row = findElement(inner, "w:tr", cursor);
    if (!row) break;
    const cells: string[] = [];
    let cellAt = 0;
    while (cellAt < row.inner.length) {
      const cell = findElement(row.inner, "w:tc", cellAt);
      if (!cell) break;
      cells.push(`<td>${blocksHtml(cell.inner, images) || "<p></p>"}</td>`);
      cellAt = cell.end;
    }
    if (cells.length) rows.push(`<tr>${cells.join("")}</tr>`);
    cursor = row.end;
  }
  if (!rows.length) return "";
  return `<table><tbody>${rows.join("")}</tbody></table>`;
}

function relsPath(partName: string): string {
  const slash = partName.lastIndexOf("/");
  const dir = slash >= 0 ? partName.slice(0, slash) : "";
  const file = slash >= 0 ? partName.slice(slash + 1) : partName;
  return `${dir}/_rels/${file}.rels`;
}

function resolveTarget(baseFile: string, target: string): string {
  const decoded = target.replace(/\\/g, "/");
  if (decoded.startsWith("/")) return decoded.slice(1);
  const parts = baseFile.split("/").slice(0, -1);
  for (const bit of decoded.split("/")) {
    if (!bit || bit === ".") continue;
    if (bit === "..") parts.pop();
    else parts.push(bit);
  }
  return parts.join("/");
}

function readRelationships(xml: string): { id: string; type: string; target: string }[] {
  const out: { id: string; type: string; target: string }[] = [];
  const pattern = /<Relationship\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const source = match[1] ?? "";
    const id = attr(source, "Id");
    const type = attr(source, "Type");
    const target = attr(source, "Target");
    if (id && type && target) out.push({ id, type, target });
  }
  return out;
}

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  return "image/png";
}

function imageMap(files: Map<string, Buffer>, partName: string): Map<string, string> {
  const rels = files.get(relsPath(partName))?.toString("utf8") ?? "";
  const map = new Map<string, string>();
  for (const rel of readRelationships(rels)) {
    if (!rel.type.endsWith("/image")) continue;
    const path = resolveTarget(partName, rel.target);
    const data = files.get(path);
    if (!data) continue;
    map.set(rel.id, `data:${mimeFor(path)};base64,${data.toString("base64")}`);
  }
  return map;
}

function references(sect: string, tag: "w:headerReference" | "w:footerReference"): { type: string; id: string }[] {
  const out: { type: string; id: string }[] = [];
  const pattern = new RegExp(`<${tag}\\b([^>]*)\\/?>`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sect))) {
    const source = match[1] ?? "";
    const type = attr(source, "w:type") || "default";
    const id = attr(source, "r:id");
    if (id) out.push({ type, id });
  }
  return out;
}

function bandFrom(kind: "header" | "footer", sect: string, files: Map<string, Buffer>, rels: { id: string; type: string; target: string }[]): DocumentBand | null {
  const tag = kind === "header" ? "w:headerReference" : "w:footerReference";
  const refs = references(sect, tag);
  if (!refs.length) return null;
  const slots: Record<string, string> = { default: "", first: "", even: "" };
  for (const ref of refs) {
    const rel = rels.find((item) => item.id === ref.id);
    if (!rel) continue;
    const path = resolveTarget("word/document.xml", rel.target);
    const xml = files.get(path)?.toString("utf8");
    if (!xml) continue;
    const slot = ref.type === "first" || ref.type === "even" ? ref.type : "default";
    slots[slot] = blocksHtml(xml, imageMap(files, path));
  }
  const band: DocumentBand = {
    differentFirstPage: /<w:titlePg\b/.test(sect),
    differentOddEven: /<w:evenAndOddHeaders\b/.test(sect),
    defaultHtml: slots.default ?? "",
    firstHtml: slots.first ?? "",
    evenHtml: slots.even ?? "",
  };
  if (!bandHasContent(band)) return null;
  return band;
}

export function readBands(files: Map<string, Buffer>): { header: DocumentBand | null; footer: DocumentBand | null } {
  const document = files.get("word/document.xml")?.toString("utf8") ?? "";
  const sections = [...document.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)];
  const sect = sections.at(-1)?.[0] ?? "";
  const rels = readRelationships(files.get("word/_rels/document.xml.rels")?.toString("utf8") ?? "");
  return {
    header: bandFrom("header", sect, files, rels),
    footer: bandFrom("footer", sect, files, rels),
  };
}

function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: "body", attrs: {}, children: [] };
  const stack: HtmlNode[] = [root];
  const pattern = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)([^>]*)\/?>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const parent = stack[stack.length - 1] ?? root;
    if (match[1]) {
      const tag = match[1].toLowerCase();
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]?.tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    if (match[2]) {
      const tag = match[2].toLowerCase();
      const attrs: Record<string, string> = {};
      const attrSource = match[3] ?? "";
      const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let found: RegExpExecArray | null;
      while ((found = attrPattern.exec(attrSource))) attrs[found[1]!.toLowerCase()] = decodeHtml(found[3] ?? found[4] ?? "");
      const node: HtmlNode = { tag, attrs, children: [] };
      parent.children.push(node);
      const selfClosing = attrSource.trim().endsWith("/") || VOID.has(tag);
      if (!selfClosing) stack.push(node);
      continue;
    }
    const text = decodeHtml(match[4] ?? "");
    if (text.trim() || /[ \t]/.test(text)) parent.children.push(text);
  }
  return root;
}

function fieldXml(name: string): string {
  const instr =
    name === "page"
      ? " PAGE "
      : name === "pages"
        ? " NUMPAGES "
        : name === "date"
          ? " DATE "
          : name === "docId"
            ? " DOCPROPERTY AccuQualDocId "
            : name === "rev"
              ? " DOCPROPERTY AccuQualRev "
              : "";
  if (!instr) return "";
  return `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
}

function textXml(text: string, marks: { bold?: boolean; italic?: boolean; underline?: boolean }): string {
  if (!text) return "";
  const flags = [marks.bold ? "<w:b/>" : "", marks.italic ? "<w:i/>" : "", marks.underline ? '<w:u w:val="single"/>' : ""].join("");
  const props = flags ? `<w:rPr>${flags}</w:rPr>` : "";
  return `<w:r>${props}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function parseDataUrl(src: string): { ext: string; data: Buffer } | null {
  const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(src.trim());
  if (!match) return null;
  let ext = match[1]!.toLowerCase();
  if (ext === "jpg") ext = "jpeg";
  if (ext === "svg+xml") return null;
  const data = Buffer.from(match[2]!.replace(/\s+/g, ""), "base64");
  if (!data.length) return null;
  return { ext, data };
}

function drawingXml(relId: string, pictureId: number): string {
  const cx = 990600;
  const cy = 457200;
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${pictureId}" name="Picture ${pictureId}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function imageXml(src: string, bag: ImageBag): string {
  const parsed = parseDataUrl(src);
  if (!parsed) return "";
  bag.imageCount += 1;
  const id = `rId${bag.rels.length + 1}`;
  const filename = `image${bag.imageCount}.${parsed.ext}`;
  bag.files.push({ name: `word/media/${filename}`, data: parsed.data });
  bag.rels.push({ id, target: `media/${filename}` });
  return drawingXml(id, bag.imageCount);
}

function inlineXml(children: Array<HtmlNode | string>, marks: { bold?: boolean; italic?: boolean; underline?: boolean }, bag: ImageBag): string {
  let xml = "";
  for (const child of children) {
    if (typeof child === "string") {
      xml += textXml(child, marks);
      continue;
    }
    if (child.tag === "br") {
      xml += "<w:r><w:br/></w:r>";
      continue;
    }
    if (child.tag === "img") {
      xml += imageXml(child.attrs.src ?? "", bag);
      continue;
    }
    if (child.tag === "span" && child.attrs["data-doc-field"]) {
      xml += fieldXml(child.attrs["data-doc-field"]);
      continue;
    }
    if (child.tag === "p" || child.tag === "div" || child.tag === "table" || child.tag === "ul" || child.tag === "ol" || child.tag === "h1" || child.tag === "h2") continue;
    const next = { ...marks };
    if (child.tag === "b" || child.tag === "strong") next.bold = true;
    if (child.tag === "i" || child.tag === "em") next.italic = true;
    if (child.tag === "u") next.underline = true;
    xml += inlineXml(child.children, next, bag);
  }
  return xml;
}

function alignFromStyle(style: string): string {
  const match = /text-align\s*:\s*(center|right|justify|left)/i.exec(style);
  const value = match?.[1]?.toLowerCase() ?? "";
  if (value === "center" || value === "right" || value === "justify") return value;
  return "";
}

function paragraphXml(node: HtmlNode, bag: ImageBag): string {
  const align = alignFromStyle(node.attrs.style ?? "");
  const jc = align ? `<w:pPr><w:jc w:val="${align === "justify" ? "both" : align}"/></w:pPr>` : "";
  const runs = inlineXml(node.children, {}, bag);
  if (!runs && !jc) return "";
  return `<w:p>${jc}${runs}</w:p>`;
}

function blockXml(node: HtmlNode | string, bag: ImageBag): string {
  if (typeof node === "string") return node.trim() ? `<w:p>${textXml(node, {})}</w:p>` : "";
  if (node.tag === "table") return tableXml(node, bag);
  if (node.tag === "ul" || node.tag === "ol") {
    return node.children
      .filter((child): child is HtmlNode => typeof child !== "string" && child.tag === "li")
      .map((item, index) => `<w:p>${textXml(node.tag === "ol" ? `${index + 1}. ` : "• ", {})}${inlineXml(item.children, {}, bag)}</w:p>`)
      .join("");
  }
  if (node.tag === "p" || node.tag === "div" || node.tag === "h1" || node.tag === "h2" || node.tag === "li") return paragraphXml(node, bag);
  const runs = inlineXml([node], {}, bag);
  return runs ? `<w:p>${runs}</w:p>` : "";
}

function tableXml(node: HtmlNode, bag: ImageBag): string {
  const rows = node.children.flatMap((child) => {
    if (typeof child === "string") return [];
    if (child.tag === "tr") return [child];
    if (child.tag === "tbody" || child.tag === "thead") return child.children.filter((row): row is HtmlNode => typeof row !== "string" && row.tag === "tr");
    return [];
  });
  const body = rows
    .map((row) => {
      const cells = row.children.filter((cell): cell is HtmlNode => typeof cell !== "string" && (cell.tag === "td" || cell.tag === "th"));
      const xml = cells
        .map((cell) => {
          const inner = cell.children.map((child) => blockXml(child, bag)).join("") || `<w:p>${inlineXml(cell.children, {}, bag)}</w:p>`;
          return `<w:tc>${inner}</w:tc>`;
        })
        .join("");
      return `<w:tr>${xml}</w:tr>`;
    })
    .join("");
  return `<w:tbl>${body}</w:tbl>`;
}

function partXml(html: string, root: "w:hdr" | "w:ftr", bag: ImageBag): string {
  const tree = parseHtml(html);
  const body = tree.children.map((child) => blockXml(child, bag)).join("") || "<w:p/>";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<${root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">${body}</${root}>`;
}

function relsXml(rels: { id: string; target: string }[]): string {
  const rows = rels
    .map((rel) => `<Relationship Id="${rel.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${escapeXml(rel.target)}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows}</Relationships>`;
}

const CONTENT_MIME: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

export interface BandPackage {
  files: { name: string; data: Buffer }[];
  relationships: string;
  sectInner: string;
  contentDefaults: string;
  contentOverrides: string;
}

function slotsOf(band: DocumentBand): Array<"default" | "first" | "even"> {
  const slots: Array<"default" | "first" | "even"> = ["default"];
  if (band.differentFirstPage) slots.push("first");
  if (band.differentOddEven) slots.push("even");
  return slots;
}

export function filesForBands(input: { header: DocumentBand | null; footer: DocumentBand | null }): BandPackage {
  const empty: BandPackage = { files: [], relationships: "", sectInner: "", contentDefaults: "", contentOverrides: "" };
  const sides = (
    [
      ["header", "w:hdr", "w:headerReference", "header", input.header],
      ["footer", "w:ftr", "w:footerReference", "footer", input.footer],
    ] as const
  ).filter((side) => side[4] && bandHasContent(side[4]));
  if (!sides.length) return empty;

  const files: { name: string; data: Buffer }[] = [];
  const relationships: string[] = [];
  const sect: string[] = [];
  const overrides: string[] = [];
  const extensions = new Set<string>();
  let rel = 0;
  let imageCount = 0;
  let headerCount = 0;
  let footerCount = 0;
  let differentFirstPage = false;
  let differentOddEven = false;

  for (const [, root, refTag, leaf, band] of sides) {
    if (!band) continue;
    if (band.differentFirstPage) differentFirstPage = true;
    if (band.differentOddEven) differentOddEven = true;
    for (const slot of slotsOf(band)) {
      const html = slot === "first" ? band.firstHtml : slot === "even" ? band.evenHtml : band.defaultHtml;
      const bag: ImageBag = { files: [], rels: [], imageCount };
      const count = leaf === "header" ? (headerCount += 1) : (footerCount += 1);
      const part = `word/${leaf}${count}.xml`;
      files.push({ name: part, data: Buffer.from(partXml(html, root, bag)) });
      imageCount = bag.imageCount;
      if (bag.rels.length) files.push({ name: relsPath(part), data: Buffer.from(relsXml(bag.rels)) });
      for (const image of bag.files) {
        files.push(image);
        const ext = image.name.split(".").pop()?.toLowerCase() ?? "";
        if (ext) extensions.add(ext);
      }
      rel += 1;
      const id = `rId${rel}`;
      const type = leaf === "header" ? "header" : "footer";
      relationships.push(
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${leaf}${count}.xml"/>`,
      );
      sect.push(`<${refTag} w:type="${slot}" r:id="${id}"/>`);
      const contentType =
        leaf === "header"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";
      overrides.push(`<Override PartName="/${part}" ContentType="${contentType}"/>`);
    }
  }
  if (differentFirstPage) sect.push("<w:titlePg/>");
  if (differentOddEven) sect.push("<w:evenAndOddHeaders/>");

  const defaults = [...extensions]
    .filter((ext) => CONTENT_MIME[ext])
    .map((ext) => `<Default Extension="${ext === "jpeg" ? "jpeg" : ext}" ContentType="${CONTENT_MIME[ext]}"/>`)
    .join("");

  return {
    files,
    relationships: relationships.join(""),
    sectInner: sect.join(""),
    contentDefaults: defaults,
    contentOverrides: overrides.join(""),
  };
}

import { inflateRawSync } from "node:zlib";

/**
 * A usable .docx subset: headings, paragraphs, bold, italic, underline,
 * lists, simple tables, and page breaks. Header and footer parts round-trip
 * (text, tables, images, page fields, and first/odd/even variants). The body
 * still does not carry text boxes or comments. A document with no header or
 * footer of its own keeps the app header and footer at print time.
 */

import { type DocumentBand, filesForBands, readBands } from "./docxBands.js";

interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: Array<HtmlNode | string>;
}

const VOID = new Set(["br", "img", "hr"]);

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function encode(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function sanitizeDocumentHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: "body", attrs: {}, children: [] };
  const stack: HtmlNode[] = [root];
  const source = sanitizeDocumentHtml(html);
  const pattern = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)([^>]*)\/?>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
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
      let attr: RegExpExecArray | null;
      while ((attr = attrPattern.exec(attrSource))) attrs[attr[1]!.toLowerCase()] = decode(attr[3] ?? attr[4] ?? "");
      const node: HtmlNode = { tag, attrs, children: [] };
      parent.children.push(node);
      const selfClosing = attrSource.trim().endsWith("/") || VOID.has(tag);
      if (!selfClosing) stack.push(node);
      continue;
    }
    const text = decode(match[4] ?? "");
    if (text.trim() || text.includes(" ")) parent.children.push(text);
  }
  return root;
}

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

function runsFrom(node: HtmlNode | string, marks: { bold?: boolean; italic?: boolean; underline?: boolean }): Run[] {
  if (typeof node === "string") {
    if (!node) return [];
    return [{ text: node, ...marks }];
  }
  const next = { ...marks };
  if (node.tag === "b" || node.tag === "strong") next.bold = true;
  if (node.tag === "i" || node.tag === "em") next.italic = true;
  if (node.tag === "u") next.underline = true;
  if (node.tag === "span" && node.attrs["data-fill-field"]) {
    const label = node.attrs["data-label"] || node.attrs["data-fill-field"] || "Field";
    return [{ text: `[${label}]`, underline: true }];
  }
  if (node.tag === "br") return [{ text: "\n", ...marks }];
  return node.children.flatMap((child) => runsFrom(child, next));
}

function paragraphXml(runs: Run[], style?: string): string {
  const props = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  const body = runs
    .map((run) => {
      const flags = [run.bold ? "<w:b/>" : "", run.italic ? "<w:i/>" : "", run.underline ? '<w:u w:val="single"/>' : ""].join("");
      const propsXml = flags ? `<w:rPr>${flags}</w:rPr>` : "";
      return `<w:r>${propsXml}<w:t xml:space="preserve">${encode(run.text)}</w:t></w:r>`;
    })
    .join("");
  return `<w:p>${props}${body}</w:p>`;
}

function blockXml(node: HtmlNode | string): string {
  if (typeof node === "string") return node.trim() ? paragraphXml([{ text: node }]) : "";
  if (node.tag === "h1") return paragraphXml(runsFrom(node, {}), "Heading1");
  if (node.tag === "h2" || node.tag === "h3") return paragraphXml(runsFrom(node, {}), "Heading2");
  if (node.tag === "ul" || node.tag === "ol") {
    return node.children
      .filter((child): child is HtmlNode => typeof child !== "string" && child.tag === "li")
      .map((item, index) => paragraphXml([{ text: node.tag === "ol" ? `${index + 1}. ` : "• " }, ...runsFrom(item, {})]))
      .join("");
  }
  if (node.tag === "table") {
    const rows = node.children.flatMap((child) => {
      if (typeof child === "string") return [];
      if (child.tag === "tr") return [child];
      return child.children.filter((row): row is HtmlNode => typeof row !== "string" && row.tag === "tr");
    });
    const body = rows
      .map((row) => {
        const cells = row.children.filter((cell): cell is HtmlNode => typeof cell !== "string" && (cell.tag === "td" || cell.tag === "th"));
        const xml = cells.map((cell) => `<w:tc>${paragraphXml(runsFrom(cell, cell.tag === "th" ? { bold: true } : {}))}</w:tc>`).join("");
        return `<w:tr>${xml}</w:tr>`;
      })
      .join("");
    return `<w:tbl>${body}</w:tbl>`;
  }
  if (node.tag === "div" && node.attrs.class?.includes("aq-page-break")) {
    return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  }
  if (node.tag === "p" || node.tag === "div") return paragraphXml(runsFrom(node, {}));
  return node.children.map((child) => blockXml(child)).join("");
}

export function htmlToDocumentXml(html: string, identity?: { docId?: string | null; rev?: string | null }, sectInner = ""): string {
  const tree = parseHtml(html);
  const head: string[] = [];
  const docId = identity?.docId?.trim();
  const rev = identity?.rev?.trim();
  if (docId || rev) head.push(paragraphXml([{ text: [docId ? `Doc ID: ${docId}` : "", rev ? `Rev: ${rev}` : ""].filter(Boolean).join("    "), bold: true }]));
  const body = tree.children.map((child) => blockXml(child)).join("") || paragraphXml([{ text: "" }]);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${head.join("")}${body}<w:sectPr>${sectInner}<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body>
</w:document>`;
}

function textOf(xml: string): string {
  return decode(xml.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** Reads paragraph, heading, list, table, and page-break text out of document.xml. */
export function documentXmlToHtml(xml: string): string {
  const blocks: string[] = [];
  const pattern = /<w:p[\s>][\s\S]*?<\/w:p>|<w:tbl[\s>][\s\S]*?<\/w:tbl>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const chunk = match[0];
    if (chunk.startsWith("<w:tbl")) {
      const rows = [...chunk.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((row) => {
        const cells = [...row[0].matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)].map((cell) => `<td>${encode(textOf(cell[0]))}</td>`);
        return `<tr>${cells.join("")}</tr>`;
      });
      if (rows.length) blocks.push(`<table><tbody>${rows.join("")}</tbody></table>`);
      continue;
    }
    if (/w:type="page"/.test(chunk)) {
      blocks.push('<div class="aq-page-break"></div>');
      continue;
    }
    const text = textOf(chunk);
    if (!text) continue;
    const style = /w:val="Heading1"/.test(chunk) ? "h1" : /w:val="Heading2"/.test(chunk) ? "h2" : "";
    const bold = /<w:b\/>/.test(chunk);
    const italic = /<w:i\/>/.test(chunk);
    const underline = /<w:u[\s/>]/.test(chunk);
    let inner = encode(text);
    if (underline) inner = `<u>${inner}</u>`;
    if (italic) inner = `<i>${inner}</i>`;
    if (bold && !style) inner = `<b>${inner}</b>`;
    if (style) blocks.push(`<${style}>${inner}</${style}>`);
    else if (/^• /.test(text)) blocks.push(`<ul><li>${encode(text.slice(2))}</li></ul>`);
    else if (/^\d+\. /.test(text)) blocks.push(`<ol><li>${encode(text.replace(/^\d+\. /, ""))}</li></ol>`);
    else blocks.push(`<p>${inner}</p>`);
  }
  return blocks.join("");
}

function readZip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;
    if (flags & 0x8) break;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data = compressed;
    if (method === 8) data = inflateRawSync(compressed);
    else if (method !== 0) break;
    files.set(name, data);
    offset = dataStart + compressedSize;
  }
  return files;
}

export interface ImportedDocx {
  html: string;
  header: DocumentBand | null;
  footer: DocumentBand | null;
}

export function htmlFromDocx(buffer: Buffer): ImportedDocx {
  const files = readZip(buffer);
  const document = files.get("word/document.xml");
  if (!document) throw new Error("That Word file has no document to read.");
  const bands = readBands(files);
  return { html: documentXmlToHtml(document.toString("utf8")), header: bands.header, footer: bands.footer };
}

/** Stored zip. Tests build a Word package the importer can read. */
export function officePackage(files: { name: string; data: Buffer }[]): Buffer {
  return zipStore(files);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Stored zip. Word opens it, and the reader above can take it back apart. */
function zipStore(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(file.data.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    parts.push(local, name, file.data);
    central.push(centralHeader, name);
    offset += local.length + name.length + file.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

export async function docxFromHtml(
  html: string,
  identity?: { docId?: string | null; rev?: string | null },
  bands?: { header?: DocumentBand | null; footer?: DocumentBand | null },
): Promise<Buffer> {
  const extra = filesForBands({ header: bands?.header ?? null, footer: bands?.footer ?? null });
  const document = htmlToDocumentXml(html, identity, extra.sectInner);
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${extra.contentDefaults}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  ${extra.contentOverrides}
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const documentRels = extra.relationships
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${extra.relationships}</Relationships>`
    : "";
  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes) },
    { name: "_rels/.rels", data: Buffer.from(rels) },
    { name: "word/document.xml", data: Buffer.from(document) },
    ...(documentRels ? [{ name: "word/_rels/document.xml.rels", data: Buffer.from(documentRels) }] : []),
    ...extra.files,
  ]);
}

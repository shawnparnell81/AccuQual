import QRCode from "qrcode";
import { PDFDocument } from "pdf-lib";

/** Draws a verification QR on the first page. The form renderer is unchanged; this only adds the code. */
export async function drawVerifyQr(doc: PDFDocument, url: string): Promise<void> {
  const page = doc.getPages()[0];
  if (!page) return;
  const png = await QRCode.toBuffer(url, { type: "png", margin: 0, width: 128, errorCorrectionLevel: "M" });
  const image = await doc.embedPng(png);
  const size = 52;
  page.drawImage(image, { x: page.getWidth() - 40 - size, y: 40, width: size, height: size });
}

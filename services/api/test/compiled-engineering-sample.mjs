// Loads the compiled handler (dist/, the same output Render runs) and asks it
// for the sample CSV. Auth on the reports router runs before this handler;
// this script is the step that failed after a signed-in request was allowed.
import express from "express";
import { engineeringTemplateHandler } from "../dist/modules/quality-engineering-report/controller.js";

const expectMissing = process.argv.includes("--missing");
const app = express();
app.get("/reports/engineering/template.csv", engineeringTemplateHandler);
app.use((err, _req, res, _next) => {
  const status = typeof err?.statusCode === "number" ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : "An unexpected error occurred";
  res.status(status).json({ message });
});

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const res = await fetch(`http://127.0.0.1:${port}/reports/engineering/template.csv`);
const text = await res.text();
const type = res.headers.get("content-type") ?? "";
const disposition = res.headers.get("content-disposition") ?? "";
const problems = [];

if (expectMissing) {
  if (res.status !== 500) problems.push(`status ${res.status}: ${text.slice(0, 300)}`);
  if (!text.includes("The sample supplier CSV is not included in this server build.")) problems.push(`message ${text.slice(0, 300)}`);
  if (/ENOENT|unexpected error/i.test(text)) problems.push(`not a plain message: ${text.slice(0, 300)}`);
} else {
  if (res.status !== 200) problems.push(`status ${res.status}: ${text.slice(0, 300)}`);
  if (!type.includes("text/csv")) problems.push(`content-type ${type}`);
  if (!disposition.includes('filename="quality-engineering-supplier-august-2026.csv"')) problems.push(`disposition ${disposition}`);
  if (!text.includes("monthly_metrics,2026-08,459")) problems.push("missing August claims");
  if (!text.includes("108871.03")) problems.push("missing amount");
  if (!text.includes("A60076")) problems.push("missing part");
  if (!text.includes("DMA Parts,150")) problems.push("missing DMA 150");
}

server.close();
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("ok");

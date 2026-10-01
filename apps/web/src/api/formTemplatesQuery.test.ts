import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { FORM_TEMPLATES_QUERY_KEY, formTemplatesFromBody, recordFileNamePattern } from "./formTemplatesCache.ts";

const ncr = {
  formKey: "frm-ncr-001",
  formId: "FRM-NCR-001",
  title: "Nonconformance Report",
  subjectRoute: "/iso-forms/frm-ncr-001",
  isoPath: ["Problem Solving"],
  fileNamePattern: "NCR_{recordNumber}_{date}",
  start: { createPath: "/iso-quality-forms", body: { formType: "ncr_report" }, openPath: "/iso-forms/record/{id}" },
};

const quarantine = {
  formKey: "frm-ncr-002",
  formId: "FRM-NCR-002",
  title: "Quarantine Notice",
  subjectRoute: "/iso-forms/frm-ncr-002",
  isoPath: ["Problem Solving"],
  fileNamePattern: "{formId}_{recordNumber}_{date}",
  start: { createPath: "/iso-quality-forms", body: { formType: "quarantine_notice" }, openPath: "/iso-forms/record/{id}" },
};

describe("form template query cache", () => {
  it("shares one key and stores the templates array, not the API envelope", () => {
    assert.deepEqual(FORM_TEMPLATES_QUERY_KEY, ["form-templates"]);

    const envelope = {
      fileNamePattern: "{formId}_{recordNumber}_{date}",
      templates: [ncr, quarantine],
    };
    const cached = formTemplatesFromBody(envelope);

    assert.notEqual(cached, envelope);
    assert.equal(cached, envelope.templates);
    assert.equal(typeof cached.find, "function");
    assert.equal(typeof cached.filter, "function");
    assert.equal(cached.find((row) => row.formKey === "frm-ncr-001")?.formId, "FRM-NCR-001");
    assert.equal(cached.filter((row) => row.start).map((row) => row.formKey).join(","), "frm-ncr-001,frm-ncr-002");
    assert.equal(recordFileNamePattern(cached.find((row) => row.formKey === "frm-ncr-001")), "NCR_{recordNumber}_{date}");
    assert.equal(recordFileNamePattern(cached.find((row) => row.formKey === "missing")), "{formId}_{recordNumber}_{date}");
  });

  it("keeps an array that is already the cache shape", () => {
    const rows = [quarantine];
    assert.equal(formTemplatesFromBody(rows), rows);
  });

  it("does not treat a missing body as a list the sidebar can filter", () => {
    assert.deepEqual(formTemplatesFromBody(null), []);
    assert.deepEqual(formTemplatesFromBody({ fileNamePattern: "{formId}_{recordNumber}_{date}" }), []);
    assert.equal(recordFileNamePattern(undefined), "{formId}_{recordNumber}_{date}");
  });

  it("keeps the list-page query as an array the record page and sidebar can read", async () => {
    const client = new QueryClient();
    const envelope = {
      fileNamePattern: "{formId}_{recordNumber}_{date}",
      templates: [ncr, quarantine],
    };
    await client.fetchQuery({
      queryKey: FORM_TEMPLATES_QUERY_KEY,
      queryFn: async () => formTemplatesFromBody(envelope),
    });
    const cached = client.getQueryData<typeof ncr[]>(FORM_TEMPLATES_QUERY_KEY);
    assert.ok(Array.isArray(cached));
    assert.equal(cached.find((row) => row.formKey === "frm-ncr-002")?.title, "Quarantine Notice");
    assert.deepEqual(
      cached.filter((row) => row.start).map((row) => row.formKey),
      ["frm-ncr-001", "frm-ncr-002"],
    );
    assert.equal(recordFileNamePattern(cached.find((row) => row.formKey === "frm-ncr-001")), "NCR_{recordNumber}_{date}");
  });
});

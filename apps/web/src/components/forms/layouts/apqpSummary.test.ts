import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apqpSummaryLayout } from "./apqpSummary.ts";
import { inputTypeForFieldKind } from "../formInputType.ts";
import type { FormLayout, TableBlock } from "./types.ts";

function table(layout: FormLayout, name: string): TableBlock {
  for (const section of layout.sections) {
    for (const block of section.blocks) {
      if (block.type === "table" && block.name === name) return block;
    }
  }
  throw new Error(`missing table ${name}`);
}

describe("APQP summary inputs", () => {
  it("uses a text input for status notes and a number input only for the sample count", () => {
    const statusTables = ["processCapability", "gageTestEquipment", "processMonitoring", "packagingShipping"];
    for (const name of statusTables) {
      for (const column of table(apqpSummaryLayout, name).columns) {
        assert.equal(column.kind, "text", `${name}.${column.key}`);
        assert.equal(inputTypeForFieldKind(column.kind), "text");
      }
    }

    const samples = table(apqpSummaryLayout, "initialProductionSamples");
    assert.deepEqual(
      samples.columns.map((column) => [column.label, inputTypeForFieldKind(column.kind)]),
      [
        ["Samples", "number"],
        ["Characteristics", "text"],
        ["Acceptable", "text"],
      ],
    );

    const signoffs = table(apqpSummaryLayout, "signoffs");
    assert.deepEqual(
      signoffs.columns.map((column) => [column.label, inputTypeForFieldKind(column.kind)]),
      [
        ["Team Member / Title", "text"],
        ["Date", "date"],
      ],
    );
  });

  it("leaves header dates and the approval date as dates", () => {
    const header = apqpSummaryLayout.sections[0]!;
    const dateField = header.blocks[2];
    assert.equal(dateField?.type, "row");
    if (dateField?.type === "row") {
      assert.equal(dateField.fields[0]?.kind, "date");
      assert.equal(inputTypeForFieldKind(dateField.fields[0]!.kind), "date");
    }

    const approval = apqpSummaryLayout.sections[2]!;
    const approvalRow = approval.blocks[0];
    assert.equal(approvalRow?.type, "row");
    if (approvalRow?.type === "row") {
      assert.equal(approvalRow.fields[0]?.kind, "select");
      assert.equal(approvalRow.fields[1]?.kind, "date");
      assert.deepEqual(
        approvalRow.fields.map((field) => field.label),
        ["Approved:", "Date Approved:"],
      );
    }
  });
});

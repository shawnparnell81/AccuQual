import { describe, expect, it } from "vitest";
import { applyFieldMapping, applyFieldMappingSafe, applyValidation, categorizeError, evaluateTrigger, mapInboundRecord } from "../src/modules/erp/erpMappingEngine.js";

describe("applyFieldMapping", () => {
  it("maps a field with no transform straight through", () => {
    expect(applyFieldMapping({ name: "Acme Corp" }, [{ source: "name", target: "NAME1" }])).toEqual({ NAME1: "Acme Corp" });
  });

  it("dateFormat formats a date into YYYYMMDD", () => {
    const result = applyFieldMapping({ createdAt: new Date(Date.UTC(2026, 0, 5)) }, [{ source: "createdAt", target: "BEDAT", transform: { kind: "dateFormat", from: "ISO", to: "YYYYMMDD" } }]);
    expect(result.BEDAT).toBe("20260105");
  });

  it("statusMap maps a known status and falls back to `default` for an unmapped one", () => {
    const mapping = { source: "status", target: "SPERR", transform: { kind: "statusMap" as const, map: { active: "", disqualified: "X" }, default: "?" } };
    expect(applyFieldMapping({ status: "active" }, [mapping])).toEqual({ SPERR: "" });
    expect(applyFieldMapping({ status: "unknown_status" }, [mapping])).toEqual({ SPERR: "?" });
  });

  it("codeMap behaves the same shape as statusMap for a different field", () => {
    const mapping = { source: "status", target: "PO_STATUS", transform: { kind: "codeMap" as const, map: { draft: "D" }, default: "D" } };
    expect(applyFieldMapping({ status: "draft" }, [mapping])).toEqual({ PO_STATUS: "D" });
  });

  it("stringCase upper/lower/title", () => {
    expect(applyFieldMapping({ v: "acme corp" }, [{ source: "v", target: "u", transform: { kind: "stringCase", case: "upper" } }])).toEqual({ u: "ACME CORP" });
    expect(applyFieldMapping({ v: "ACME CORP" }, [{ source: "v", target: "l", transform: { kind: "stringCase", case: "lower" } }])).toEqual({ l: "acme corp" });
    expect(applyFieldMapping({ v: "acme corp" }, [{ source: "v", target: "t", transform: { kind: "stringCase", case: "title" } }])).toEqual({ t: "Acme Corp" });
  });

  it("staticValue ignores the source record entirely", () => {
    expect(applyFieldMapping({ anything: "x" }, [{ source: "anything", target: "COUNTRY", transform: { kind: "staticValue", value: "US" } }])).toEqual({ COUNTRY: "US" });
  });

  it("template substitutes {{field}} placeholders from the source record, never evaluates code", () => {
    const result = applyFieldMapping({ firstName: "Ada", lastName: "Lovelace" }, [{ source: "unused", target: "fullName", transform: { kind: "template", template: "{{firstName}} {{lastName}}" } }]);
    expect(result.fullName).toBe("Ada Lovelace");
  });

  it("dot-path source resolution reaches a nested field", () => {
    expect(applyFieldMapping({ address: { city: "Springfield" } }, [{ source: "address.city", target: "ORT01" }])).toEqual({ ORT01: "Springfield" });
  });

  it("numeric round/multiply/divide/add", () => {
    expect(applyFieldMapping({ v: 4.6 }, [{ source: "v", target: "r", transform: { kind: "numeric", op: "round" } }])).toEqual({ r: 5 });
    expect(applyFieldMapping({ v: 10 }, [{ source: "v", target: "m", transform: { kind: "numeric", op: "multiply", value: 2.5 } }])).toEqual({ m: 25 });
    expect(applyFieldMapping({ v: 10 }, [{ source: "v", target: "d", transform: { kind: "numeric", op: "divide", value: 4 } }])).toEqual({ d: 2.5 });
    expect(applyFieldMapping({ v: 10 }, [{ source: "v", target: "a", transform: { kind: "numeric", op: "add", value: -3 } }])).toEqual({ a: 7 });
  });

  it("boolean invert/toYesNo/toTrueFalseString", () => {
    expect(applyFieldMapping({ v: true }, [{ source: "v", target: "i", transform: { kind: "boolean", op: "invert" } }])).toEqual({ i: false });
    expect(applyFieldMapping({ v: true }, [{ source: "v", target: "yn", transform: { kind: "boolean", op: "toYesNo" } }])).toEqual({ yn: "Yes" });
    expect(applyFieldMapping({ v: false }, [{ source: "v", target: "tf", transform: { kind: "boolean", op: "toTrueFalseString" } }])).toEqual({ tf: "false" });
  });
});

describe("mapInboundRecord", () => {
  it("reverses a plain (no-transform) mapping", () => {
    const result = mapInboundRecord({ NAME1: "Acme Corp" }, [{ source: "name", target: "NAME1" }]);
    expect(result).toEqual({ fields: { name: "Acme Corp" }, unmappableFields: [] });
  });

  it("reverses a statusMap via its own map, and flags a value with no matching key as unmappable", () => {
    const mapping = { source: "status", target: "SPERR", transform: { kind: "statusMap" as const, map: { active: "", disqualified: "X" } } };
    expect(mapInboundRecord({ SPERR: "X" }, [mapping])).toEqual({ fields: { status: "disqualified" }, unmappableFields: [] });
    const unknown = mapInboundRecord({ SPERR: "Q" }, [mapping]);
    expect(unknown.unmappableFields).toEqual(["status"]);
  });

  it("reverses numeric add/multiply arithmetically", () => {
    const addMapping = { source: "qty", target: "QTY", transform: { kind: "numeric" as const, op: "add" as const, value: 5 } };
    expect(mapInboundRecord({ QTY: 15 }, [addMapping]).fields).toEqual({ qty: 10 });
    const mulMapping = { source: "cost", target: "COST", transform: { kind: "numeric" as const, op: "multiply" as const, value: 2 } };
    expect(mapInboundRecord({ COST: 20 }, [mulMapping]).fields).toEqual({ cost: 10 });
  });

  it("flags a lossy transform (staticValue) as unmappable and passes the raw ERP value through", () => {
    const mapping = { source: "country", target: "LAND1", transform: { kind: "staticValue" as const, value: "US" } };
    const result = mapInboundRecord({ LAND1: "DE" }, [mapping]);
    expect(result.fields).toEqual({ country: "DE" });
    expect(result.unmappableFields).toEqual(["country"]);
  });

  it("skips a push-only mapping entirely", () => {
    const mapping = { source: "internalOnly", target: "X", direction: "push" as const };
    expect(mapInboundRecord({ X: "value" }, [mapping]).fields).toEqual({});
  });
});

describe("evaluateTrigger", () => {
  it("matches when no trigger rules are configured (always eligible, same as before triggers existed)", () => {
    expect(evaluateTrigger([], { on: "create" })).toBe(true);
  });

  it("matches a plain on-event rule with no statusValues filter", () => {
    expect(evaluateTrigger([{ on: "create" }], { on: "create" })).toBe(true);
    expect(evaluateTrigger([{ on: "create" }], { on: "update" })).toBe(false);
  });

  it("a statusChange rule with statusValues only matches a listed value", () => {
    const triggers = [{ on: "statusChange" as const, statusValues: ["disqualified", "probation"] }];
    expect(evaluateTrigger(triggers, { on: "statusChange", statusValue: "disqualified" })).toBe(true);
    expect(evaluateTrigger(triggers, { on: "statusChange", statusValue: "active" })).toBe(false);
    expect(evaluateTrigger(triggers, { on: "statusChange" })).toBe(false);
  });

  it("matches if ANY configured trigger rule matches", () => {
    const triggers = [{ on: "create" as const }, { on: "workflowEvent" as const }];
    expect(evaluateTrigger(triggers, { on: "workflowEvent" })).toBe(true);
  });
});

describe("applyValidation", () => {
  it("flags a missing required field", () => {
    const errors = applyValidation({}, [{ field: "name", required: true }]);
    expect(errors).toEqual([{ field: "name", message: "name is required" }]);
  });

  it("passes a present required field and skips type checks on absent optional fields", () => {
    expect(applyValidation({ name: "Acme" }, [{ field: "name", required: true }, { field: "notes", type: "string" }])).toEqual([]);
  });

  it("flags a value outside allowedValues", () => {
    const errors = applyValidation({ status: "bogus" }, [{ field: "status", allowedValues: ["active", "inactive"] }]);
    expect(errors).toHaveLength(1);
  });

  it("flags a type mismatch", () => {
    expect(applyValidation({ qty: "not a number" }, [{ field: "qty", type: "number" }])).toHaveLength(1);
    expect(applyValidation({ qty: 5 }, [{ field: "qty", type: "number" }])).toEqual([]);
  });

  it("flags a value that doesn't match a regex pattern", () => {
    expect(applyValidation({ code: "abc" }, [{ field: "code", pattern: "^[A-Z]{2}\\d{4}$" }])).toHaveLength(1);
    expect(applyValidation({ code: "AB1234" }, [{ field: "code", pattern: "^[A-Z]{2}\\d{4}$" }])).toEqual([]);
  });

  it("truncates an overlong value before matching against a pattern (ReDoS defense-in-depth) — a pattern that only matches 250+ chars fails against a 300-char value", () => {
    const longValue = "a".repeat(300);
    expect(applyValidation({ code: longValue }, [{ field: "code", pattern: "^.{250,}$" }])).toHaveLength(1);
  });

  it("cross-field equalsField check", () => {
    expect(applyValidation({ email: "a@x.com", confirmEmail: "a@x.com" }, [{ field: "email", equalsField: "confirmEmail" }])).toEqual([]);
    expect(applyValidation({ email: "a@x.com", confirmEmail: "b@x.com" }, [{ field: "email", equalsField: "confirmEmail" }])).toHaveLength(1);
  });
});

describe("categorizeError", () => {
  it("maps each known pipeline stage to its errorType", () => {
    expect(categorizeError("mapping")).toBe("mappingError");
    expect(categorizeError("validation")).toBe("validationError");
    expect(categorizeError("transform")).toBe("transformError");
    expect(categorizeError("trigger")).toBe("triggerError");
    expect(categorizeError("erpApi")).toBe("erpApiError");
  });

  it("an undefined stage (an uncaught exception with no known attribution) becomes unexpectedError", () => {
    expect(categorizeError(undefined)).toBe("unexpectedError");
  });
});

describe("applyFieldMappingSafe", () => {
  it("behaves the same as applyFieldMapping when nothing throws", () => {
    const mappings = [{ source: "name", target: "NAME1" }];
    expect(applyFieldMappingSafe({ name: "Acme" }, mappings)).toEqual({ fields: { NAME1: "Acme" }, errors: [] });
  });

  it("maps every field independently, including one with a transform, in a single non-throwing pass", () => {
    const mappings = [
      { source: "name", target: "NAME1" },
      { source: "qty", target: "MENGE", transform: { kind: "numeric" as const, op: "multiply" as const, value: 2 } },
    ];
    const result = applyFieldMappingSafe({ name: "Acme", qty: 5 }, mappings);
    expect(result.errors).toEqual([]);
    expect(result.fields).toEqual({ NAME1: "Acme", MENGE: 10 });
  });
});

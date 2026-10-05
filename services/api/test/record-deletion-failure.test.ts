import { describe, expect, it } from "vitest";
import { deletionFailure, postgresFailure } from "../src/modules/records/recordDeletion.js";

function driverError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("record delete database errors", () => {
  it("reads a SQLSTATE buried under the driver wrapper", () => {
    const driver = driverError('update or delete on table "ncr" violates foreign key constraint "csa_fai_records_ncr_id_ncr_id_fk"', "23503");
    const query = new Error("Failed query: delete from ncr");
    query.cause = driver;
    const outer = new Error("outer");
    outer.cause = query;

    expect(postgresFailure(outer).code).toBe("23503");
    const blocked = deletionFailure(outer);
    expect(blocked?.statusCode).toBe(409);
    expect(blocked?.message).toMatch(/still linked/);
  });

  it("turns an append-only quarantine decision into a plain refusal", () => {
    const driver = driverError("A quarantine decision cannot be edited or deleted (decision 4)", "23000");
    const query = new Error("Failed query: delete from quarantine_resolutions");
    query.cause = driver;

    const blocked = deletionFailure(query);
    expect(blocked?.statusCode).toBe(409);
    expect(blocked?.message).toMatch(/decision on file/);
    expect(blocked?.message).not.toMatch(/unexpected error/i);
  });

  it("leaves an ordinary programming error alone", () => {
    expect(deletionFailure(new Error("Unknown column ncr_id"))).toBeNull();
  });
});

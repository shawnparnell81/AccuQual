import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import { BUSY_RETRIES, queryRetryDelay, shouldRetryQuery } from "./queryRetry";
import { recordAccessText } from "../components/shared/RecordAccessMessage";

function failure(status: number, headers: Record<string, string> = {}) {
  const config = { headers: new AxiosHeaders() } as never;
  return new AxiosError("x", String(status), config, undefined, { status, statusText: "", headers, config, data: {} } as never);
}

test("a busy server (429) is retried a few times; a refusal or missing record is not", () => {
  for (let n = 0; n < BUSY_RETRIES; n++) assert.equal(shouldRetryQuery(n, failure(429)), true);
  assert.equal(shouldRetryQuery(BUSY_RETRIES, failure(429)), false);
  assert.equal(shouldRetryQuery(0, failure(403)), false);
  assert.equal(shouldRetryQuery(0, failure(404)), false);
  assert.equal(shouldRetryQuery(0, failure(500)), true);
  assert.equal(shouldRetryQuery(1, failure(500)), false);
  assert.equal(shouldRetryQuery(0, new Error("network")), true);
});

test("waits for Retry-After, otherwise backs off, never past 30 s", () => {
  assert.equal(queryRetryDelay(0, failure(429, { "retry-after": "7" })), 7000);
  assert.equal(queryRetryDelay(0, failure(429)), 1000);
  assert.equal(queryRetryDelay(2, failure(429)), 4000);
  assert.equal(queryRetryDelay(9, failure(429)), 30000);
});

test("a record page says busy, missing, or refused instead of a bare 'Couldn't load'", () => {
  const fb = "Couldn't load this 8D report. Refresh the page and try again.";
  assert.match(recordAccessText(failure(429), fb, "this 8D report"), /busy/);
  assert.match(recordAccessText(failure(404), fb, "this 8D report"), /^This 8D report was not found/);
  assert.match(recordAccessText(failure(403), fb, "this 8D report"), /permission/);
  assert.equal(recordAccessText(failure(500), fb, "this 8D report"), fb);
});

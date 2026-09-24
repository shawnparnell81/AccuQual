// Public website contact form: validation, honeypot, and the "not switched on" answer when no inbox is configured.
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";

const app = createApp();
const valid = { name: "Pat Buyer", email: "pat@example.com", company: "Acme", message: "We'd like a walkthrough of the NCR module." };

describe("POST /contact", () => {
  it("needs no session", async () => {
    const res = await request(app).post("/contact").send(valid);
    // 202 when an inbox is configured, 503 when it isn't — never 401.
    expect([202, 503]).toContain(res.status);
  });

  it("rejects a bad email and a too-short message", async () => {
    expect((await request(app).post("/contact").send({ ...valid, email: "nope" })).status).toBe(400);
    expect((await request(app).post("/contact").send({ ...valid, message: "hi" })).status).toBe(400);
  });

  it("answers a filled honeypot like a success without doing anything", async () => {
    const res = await request(app).post("/contact").send({ ...valid, website: "http://spam.example" });
    expect(res.status).toBe(202);
  });
});

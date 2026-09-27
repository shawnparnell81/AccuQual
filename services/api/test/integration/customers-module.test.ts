import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/db/index.js";

const app = createApp();

describe("Customer onboarding is not part of AccuQual", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("does not serve customer onboarding routes", async () => {
    expect((await request(app).get("/customers")).status).toBe(404);
    expect((await request(app).post("/customers").send({ legalName: "Acme" })).status).toBe(404);
    expect((await request(app).get("/customers/1")).status).toBe(404);
    expect((await request(app).put("/customers/1").send({ legalName: "Acme" })).status).toBe(404);
    expect((await request(app).get("/customers/1/scorecard")).status).toBe(404);
    expect((await request(app).post("/customers/1/scorecard").send({ period: "2026-Q1" })).status).toBe(404);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/db/index.js";

const app = createApp();

describe("Sales accounts are not part of AccuQual", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("does not serve sales account routes", async () => {
    expect((await request(app).get("/sales/accounts")).status).toBe(404);
    expect((await request(app).post("/sales/accounts").send({ customerName: "Acme" })).status).toBe(404);
    expect((await request(app).get("/sales/accounts/1")).status).toBe(404);
    expect((await request(app).put("/sales/accounts/1").send({ customerName: "Acme" })).status).toBe(404);
  });
});

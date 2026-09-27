import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/db/index.js";

const app = createApp();

describe("Customer communications are not part of AccuQual", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("does not serve customer communication routes", async () => {
    expect((await request(app).get("/customer-communications")).status).toBe(404);
    expect((await request(app).post("/customer-communications").send({ customerId: 1, commsType: "email", summary: "hello" })).status).toBe(404);
    expect((await request(app).get("/customer-communications/1")).status).toBe(404);
    expect((await request(app).patch("/customer-communications/1").send({ summary: "updated" })).status).toBe(404);
  });
});

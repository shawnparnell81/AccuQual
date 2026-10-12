import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { db } from "../../src/db/index.js";
import { seedTestRoles } from "../helpers/seedDefaults.js";

let managerToken: string;

async function loginAs(role: string): Promise<string> {
  // Uses the test auth helper pattern from existing integration tests.
  const { createTestUser, getTestToken } = await import("../helpers/testAuth.js");
  const user = await createTestUser({ role });
  return getTestToken(user);
}

beforeAll(async () => {
  await seedTestRoles();
  managerToken = await loginAs("quality_manager");
});

describe("FAI & Inspection endpoints", () => {
  it("requires fai.view for the dashboard", async () => {
    const other = await loginAs("operator");
    const res = await request(app).get("/fai-inspection/dashboard").set("Authorization", `Bearer ${other}`);
    expect(res.status).toBe(403);
  });

  it("creates a plan with characteristics", async () => {
    const res = await request(app)
      .post("/fai-inspection/plans")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        partNumber: "TEST-001",
        partDescription: "Test widget",
        riskClass: "Major",
        characteristics: [
          { name: "Diameter", charType: "Major", limitType: "plus_minus", nominal: "10", tolerancePlus: "0.1", toleranceMinus: "0.1", unit: "mm" },
          { name: "Finish", charType: "Minor", limitType: "attribute" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.partNumber).toBe("TEST-001");
    expect(res.body.revision).toBe(1);
  });

  it("bumps plan revision when characteristics change", async () => {
    const created = await request(app).post("/fai-inspection/plans")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ partNumber: "TEST-002", characteristics: [{ name: "Length", limitType: "plus_minus", nominal: "5", tolerancePlus: "0.05", toleranceMinus: "0.05" }] });
    const id = created.body.id;
    const updated = await request(app).put(`/fai-inspection/plans/${id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ characteristics: [
        { name: "Length", limitType: "plus_minus", nominal: "5", tolerancePlus: "0.05", toleranceMinus: "0.05" },
        { name: "Width", limitType: "min_max", specMin: "2", specMax: "4" },
      ]});
    expect(updated.body.revision).toBe(2);
  });

  it("rejects duplicate FAI numbers", async () => {
    const body = { faiNumber: "FAI-DUP-001", partNumber: "TEST-001", lotSize: 150 };
    const first = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${managerToken}`).send(body);
    expect(first.status).toBe(201);
    const second = await request(app).post("/fai-inspection/records").set("Authorization", `Bearer ${managerToken}`).send(body);
    expect(second.status).toBe(409);
  });

  it("copies plan characteristics with saved limits on record create", async () => {
    const plan = await request(app).post("/fai-inspection/plans")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ partNumber: "TEST-003", characteristics: [{ name: "Diameter", limitType: "plus_minus", nominal: "10", tolerancePlus: "0.2", toleranceMinus: "0.2", unit: "mm" }] });
    const rec = await request(app).post("/fai-inspection/records")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ faiNumber: "FAI-LIMIT-001", planId: plan.body.id, partNumber: "TEST-003", lotSize: 150 });
    expect(rec.status).toBe(201);
    const got = await request(app).get(`/fai-inspection/records/${rec.body.id}`).set("Authorization", `Bearer ${managerToken}`);
    const line = got.body.lines[0];
    expect(line.limitLow).toBe("9.8");
    expect(line.limitHigh).toBe("10.2");
    // AQL lookup ran: lot 150, level II -> F, n=20
    expect(got.body.codeLetter).toBe("F");
    expect(got.body.aqlSampleSize).toBe(20);
  });

  it("wrong PIN on sign-off returns 401", async () => {
    const rec = await request(app).post("/fai-inspection/records")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ faiNumber: "FAI-PIN-001", partNumber: "TEST-001" });
    const res = await request(app).post(`/fai-inspection/records/${rec.body.id}/sign`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ pin: "0000", certified: true, outcome: "passed", description: "sign" });
    expect(res.status).toBe(401);
  });
});

import { ensureTestCompany } from "../helpers/company.js";
// Bug G: "Log Calibration Event" silently skipped writing the calibrations
// row when the form had no valid performed date, yet the UI toasted success.
// The version endpoint now reports whether the event was logged.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { equipment, calibrations } from "../../src/drizzle/schema/calibration.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let qualityToken: string;

async function calibrationEventCount(equipmentId: number) {
  const rows = await db.select().from(calibrations).where(eq(calibrations.equipmentId, equipmentId));
  return rows.length;
}

describe("calibration version reports whether the event was logged", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [user] = await db
      .insert(users)
      .values({ email: `cal-version-${suffix}@test.local`, passwordHash: "unused" })
      .returning();
    qualityToken = signAccessToken({
      sub: String(user!.id),
      roleId: null,
      roleName: "operator",
      department: "quality",
    });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("reports calibrationEventLogged: false and writes no row without a performed date", async () => {
    const created = await request(app)
      .post("/equipment")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ name: "G Fixture Gauge", calibrationIntervalDays: 90 });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const saved = await request(app)
      .post(`/forms/calibration/${id}/save`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ entityId: id, data: { result: "pass", technicianName: "Shawn" } });
    expect(saved.status).toBe(200);

    const version = await request(app)
      .post(`/forms/calibration/${id}/version`)
      .set("Authorization", `Bearer ${qualityToken}`);
    expect(version.status).toBe(200);
    expect(version.body.calibrationEventLogged).toBe(false);
    expect(await calibrationEventCount(id)).toBe(0);
  });

  it("reports calibrationEventLogged: true and writes one row with a performed date", async () => {
    const created = await request(app)
      .post("/equipment")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ name: "G Fixture Gauge 2", calibrationIntervalDays: 90 });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const saved = await request(app)
      .post(`/forms/calibration/${id}/save`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ entityId: id, data: { performedAt: "2026-10-01", result: "pass", technicianName: "Shawn" } });
    expect(saved.status).toBe(200);

    const version = await request(app)
      .post(`/forms/calibration/${id}/version`)
      .set("Authorization", `Bearer ${qualityToken}`);
    expect(version.status).toBe(200);
    expect(version.body.calibrationEventLogged).toBe(true);
    expect(await calibrationEventCount(id)).toBe(1);

    // Equipment still exists and is untouched by the fix's response shape change.
    const [row] = await db.select().from(equipment).where(eq(equipment.id, id));
    expect(row?.id).toBe(id);
  });
});

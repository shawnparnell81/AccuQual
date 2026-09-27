import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { documents } from "../../src/drizzle/schema/documents.js";
import { controlledVersions } from "../../src/drizzle/schema/versioning.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { OBSOLETE_ARCHIVE_CATEGORY } from "../../src/modules/documents/obsoleteArchive.js";

const app = createApp();
const suffix = Date.now();

describe("Obsolete / Archive folder (real DB + real HTTP path)", () => {
  let token: string;
  let adminToken: string;
  let adminId: number;

  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [user] = await db.insert(users).values({ email: `obsolete-archive-${suffix}@test.local`, passwordHash: "unused", department: "quality" }).returning();
    token = signAccessToken({ sub: String(user!.id), roleId: null, roleName: "quality_manager", department: "quality" });
    const [admin] = await db.insert(users).values({ email: `obsolete-archive-admin-${suffix}@test.local`, passwordHash: "unused", department: null }).returning();
    adminId = admin!.id;
    adminToken = signAccessToken({ sub: String(adminId), roleId: null, roleName: "admin", department: null });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("moves a document into the archive, keeps the revision, logs the move, and hides it from active search", async () => {
    const title = `Superseded gage procedure ${suffix}`;
    const created = await request(app).post("/documents").set("Authorization", `Bearer ${token}`).send({ title, category: "product-alerts" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    const draftId = created.body.openVersionId as number;

    const [before] = await db
      .select()
      .from(controlledVersions)
      .where(and(eq(controlledVersions.subjectType, "document"), eq(controlledVersions.subjectId, id), eq(controlledVersions.id, draftId)));
    expect(before?.status).toBe("draft");
    expect((before?.payload as { category?: string }).category).toBe("product-alerts");

    // A released revision is frozen. Moving must not rewrite it.
    await db.update(controlledVersions).set({ status: "published" }).where(eq(controlledVersions.id, draftId));

    const moved = await request(app).post(`/documents/${id}/move-to-obsolete`).set("Authorization", `Bearer ${token}`).send({ reason: "Superseded by Rev C", acknowledged: true });
    expect(moved.status).toBe(200);
    expect(moved.body.category).toBe(OBSOLETE_ARCHIVE_CATEGORY);
    expect(moved.body.status).toBe("obsolete");

    const [live] = await db.select().from(documents).where(eq(documents.id, id));
    expect(live?.category).toBe(OBSOLETE_ARCHIVE_CATEGORY);
    expect(live?.status).toBe("obsolete");

    const [after] = await db.select().from(controlledVersions).where(eq(controlledVersions.id, draftId));
    expect(after?.status).toBe("published");
    expect(after?.payload).toEqual(before?.payload);

    const audits = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Document"), eq(auditTrail.entityId, id)));
    const move = audits.find((row) => (row.changes as { action?: string } | null)?.action === "moved_to_obsolete");
    expect(move?.action).toBe("status_change");
    expect(move?.changes).toMatchObject({
      action: "moved_to_obsolete",
      fromCategory: "product-alerts",
      toCategory: OBSOLETE_ARCHIVE_CATEGORY,
      fromStatus: "draft",
      status: "obsolete",
      reason: "Superseded by Rev C",
    });
    expect(move?.performedBy).toBeTruthy();
    expect(move?.createdAt).toBeTruthy();

    const hidden = await request(app).get("/search").query({ q: title }).set("Authorization", `Bearer ${token}`);
    expect(hidden.status).toBe(200);
    expect(hidden.body.results.some((r: { type: string; id: number }) => r.type === "Document" && r.id === id)).toBe(false);

    const shown = await request(app).get("/search").query({ q: title, includeObsolete: "1" }).set("Authorization", `Bearer ${token}`);
    const hit = shown.body.results.find((r: { type: string; id: number }) => r.type === "Document" && r.id === id);
    expect(hit?.label).toContain("(Obsolete)");

    const listed = await request(app).get("/documents").set("Authorization", `Bearer ${token}`);
    expect(listed.body.some((row: { id: number; status: string }) => row.id === id && row.status === "obsolete")).toBe(true);

    const publish = await request(app).post(`/documents/${id}/version/${draftId}/publish`).set("Authorization", `Bearer ${token}`);
    expect(publish.status).toBe(409);
    expect(String(publish.body.message)).toMatch(/obsolete/i);

    const again = await request(app).post(`/documents/${id}/move-to-obsolete`).set("Authorization", `Bearer ${token}`).send({ reason: "Again", acknowledged: true });
    expect(again.status).toBe(409);

    let blocked = "";
    try {
      await db.update(documents).set({ title: "Renamed while archived" }).where(eq(documents.id, id));
    } catch (err) {
      let current: unknown = err;
      while (current instanceof Error) {
        blocked += ` ${current.message}`;
        current = current.cause;
      }
    }
    expect(blocked).toMatch(/read-only/i);

    const editedByQuality = await request(app).patch(`/documents/${id}`).set("Authorization", `Bearer ${token}`).send({ tags: ["nope"] });
    expect(editedByQuality.status).toBe(409);
    const editedByAdmin = await request(app).patch(`/documents/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ tags: ["nope"] });
    expect(editedByAdmin.status).toBe(409);
    const revised = await request(app).post(`/documents/${id}/draft`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(revised.status).toBe(409);

    const denied = await request(app).post(`/documents/${id}/restore`).set("Authorization", `Bearer ${token}`).send({ reason: "I am not an admin", acknowledged: true });
    expect(denied.status).toBe(403);

    const restored = await request(app).post(`/documents/${id}/restore`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Still the current procedure", acknowledged: true });
    expect(restored.status).toBe(200);
    expect(restored.body.category).toBe("product-alerts");
    expect(restored.body.status).toBe("draft");

    const [afterRestore] = await db.select().from(controlledVersions).where(eq(controlledVersions.id, draftId));
    expect(afterRestore?.payload).toEqual(before?.payload);

    const restoreAudit = (await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Document"), eq(auditTrail.entityId, id)))).find(
      (row) => (row.changes as { action?: string } | null)?.action === "restored_from_obsolete",
    );
    expect(restoreAudit?.performedBy).toBe(adminId);
    expect(restoreAudit?.createdAt).toBeTruthy();
    expect(restoreAudit?.changes).toMatchObject({
      action: "restored_from_obsolete",
      toCategory: "product-alerts",
      status: "draft",
      reason: "Still the current procedure",
    });

    const editableAgain = await request(app).patch(`/documents/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ tags: ["current"] });
    expect(editableAgain.status).toBe(200);
  });

  it("marks a file uploaded into the archive folder obsolete and still leaves a draft to attach", async () => {
    const title = `Old drawing ${suffix}`;
    const created = await request(app).post("/documents").set("Authorization", `Bearer ${token}`).send({ title, category: OBSOLETE_ARCHIVE_CATEGORY });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("draft");
    expect(created.body.openVersionId).toEqual(expect.any(Number));
    const unconfirmed = await request(app).post(`/documents/${created.body.id}/move-to-obsolete`).set("Authorization", `Bearer ${token}`).send({ reason: "No acknowledgement" });
    expect(unconfirmed.status).toBe(400);
    const moved = await request(app)
      .post(`/documents/${created.body.id}/move-to-obsolete`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Uploaded into Obsolete / Archive", confirmation: title });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe("obsolete");
    expect(moved.body.category).toBe(OBSOLETE_ARCHIVE_CATEGORY);

    const [version] = await db.select().from(controlledVersions).where(eq(controlledVersions.id, created.body.openVersionId));
    expect(version?.status).toBe("draft");
    expect((version?.payload as { category?: string }).category).toBe(OBSOLETE_ARCHIVE_CATEGORY);

    const hidden = await request(app).get("/search").query({ q: title }).set("Authorization", `Bearer ${token}`);
    expect(hidden.body.results.some((r: { id: number }) => r.id === created.body.id)).toBe(false);
  });
});

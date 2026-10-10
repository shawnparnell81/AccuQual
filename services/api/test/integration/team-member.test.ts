import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { userSites, sites } from "../../src/drizzle/schema/sites.js";
import { trainingCourses, trainingAssignments } from "../../src/drizzle/schema/training.js";
import { documents } from "../../src/drizzle/schema/documents.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { sql } from "drizzle-orm";

const app = createApp();
const suffix = Date.now();
const PASSWORD = "violet-lantern-quarry-88";

let ownerId: number;
let ownerToken: string;
let staffRoleId: number;
let siteId: number;

describe("new team member", () => {
  beforeAll(async () => {
    await ensureTestCompany();
    const [ownerRole] = await db.select().from(roles).where(eq(roles.name, "owner"));
    const [staffRole] = await db.select().from(roles).where(eq(roles.name, "staff"));
    staffRoleId = staffRole!.id;
    const [owner] = await db
      .insert(users)
      .values({ email: `team-owner-${suffix}@test.local`, passwordHash: "x", name: "Owner", roleId: ownerRole!.id, mustChangePassword: false })
      .returning();
    ownerId = owner!.id;
    ownerToken = signAccessToken({ sub: String(ownerId), roleId: ownerRole!.id, roleName: "owner", department: null, tv: 0 });
    const [site] = await db.select({ id: sites.id }).from(sites).where(eq(sites.status, "active")).limit(1);
    siteId = site!.id;
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await pool.end();
  });

  function auth(token = ownerToken) {
    return { Authorization: `Bearer ${token}` };
  }

  it("previews the permissions stored for a role and department, without inventing them from the role name", async () => {
    const preview = await request(app).get("/users/access-preview").query({ roleId: staffRoleId, department: "quality" }).set(auth());
    expect(preview.status).toBe(200);
    expect(Array.isArray(preview.body.capabilities)).toBe(true);
    expect(preview.body.adjustPath).toBe("/admin/roles-permissions");
    expect(JSON.stringify(preview.body)).not.toMatch(/full access|can edit everything/i);
    const [staff] = await db.select({ permissions: roles.permissions }).from(roles).where(eq(roles.id, staffRoleId));
    expect(preview.body.capabilities.length).toBe((staff?.permissions ?? []).length);
  });

  it("creates a team member with profile, sites, training, a document checklist, and an audit of old to new", async () => {
    const [course] = await db
      .insert(trainingCourses)
      .values({ title: `Incoming inspection ${suffix}`, active: true })
      .returning();
    const [doc] = await db
      .insert(documents)
      .values({ title: `SOP welcome ${suffix}`, status: "approved" })
      .returning();

    const email = `jamie.rivera.${suffix}@plant.example`;
    const created = await request(app)
      .post("/users")
      .set(auth())
      .send({
        email,
        password: PASSWORD,
        name: "Jamie Rivera",
        roleId: staffRoleId,
        department: "quality",
        managerId: ownerId,
        preferredName: "Jamie",
        jobTitle: "Quality inspector",
        phone: "214",
        employeeId: `E-${suffix}`,
        hireDate: "2026-03-02",
        employmentType: "full_time",
        shift: "day",
        siteLocation: "Inspection crib",
        bio: "First shift inspector.",
        requireMfa: true,
        siteIds: [siteId],
        allSites: false,
        trainingCourseIds: [course!.id],
        documentIds: [doc!.id],
        permissionRoleIds: [],
      });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe(email);
    expect(created.body.mustChangePassword).toBe(true);
    expect(created.body.preferredName).toBe("Jamie");
    expect(created.body.employeeId).toBe(`E-${suffix}`);
    expect(created.body.jobTitle).toBe("Quality inspector");
    expect(created.body.requireMfa).toBe(true);
    expect(created.body.passwordHash).toBeUndefined();
    expect(created.body.profileStored).toBe(true);
    expect(created.body.sites.map((site: { id: number }) => site.id)).toContain(siteId);
    expect(created.body.onboardingChecklist.documents.map((item: { title: string }) => item.title)).toContain(`SOP welcome ${suffix}`);
    expect(created.body.onboardingChecklist.courses.map((item: { title: string }) => item.title)).toContain(`Incoming inspection ${suffix}`);

    const memberships = await db.select().from(userSites).where(eq(userSites.userId, created.body.id));
    expect(memberships.map((row) => row.siteId)).toContain(siteId);
    const assigned = await db.select().from(trainingAssignments).where(eq(trainingAssignments.userId, created.body.id));
    expect(assigned.some((row) => row.courseId === course!.id)).toBe(true);

    const profileRow = await db.execute(sql`SELECT require_mfa, employee_id FROM users WHERE id = ${created.body.id}`);
    expect(profileRow.rows[0]).toMatchObject({ require_mfa: true, employee_id: `E-${suffix}` });

    const [audit] = await db.select().from(auditTrail).where(eq(auditTrail.entityId, created.body.id));
    const edits = (audit?.changes as { edits?: { label: string; from: string; to: string }[] } | null)?.edits ?? [];
    expect(edits.some((edit) => edit.label === "Job title" && edit.from === "(blank)" && edit.to === "Quality inspector")).toBe(true);
    expect(edits.some((edit) => edit.label === "Temporary password" && edit.to.includes("first sign-in"))).toBe(true);
    expect(JSON.stringify(audit?.changes)).not.toContain(PASSWORD);

    const signIn = await request(app).post("/auth/login").send({ email, password: PASSWORD });
    expect(signIn.status).toBe(200);
    expect(signIn.body.user.mustChangePassword).toBe(true);
    expect(signIn.body.user.pinSet).toBe(false);
    expect(signIn.body.mfaGraceEndsAt || signIn.body.mfaEnrollmentRequired).toBeTruthy();

    const asOwner = await request(app).get(`/users/${created.body.id}`).set(auth());
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.phone).toBe("214");

    const selfToken = signAccessToken({ sub: String(created.body.id), roleId: staffRoleId, roleName: "staff", department: "quality", tv: created.body.tokenVersion ?? 0 });
    const blocked = await request(app).get(`/users/${created.body.id}`).set(auth(selfToken));
    expect(blocked.status).toBe(403);

    await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, created.body.id));
    const own = await request(app).get(`/users/${created.body.id}`).set(auth(selfToken));
    expect(own.status).toBe(200);
    expect(own.body.phone).toBe("214");

    const edited = await request(app)
      .patch("/users/me/profile")
      .set(auth(selfToken))
      .send({ phone: "215", preferredName: "J.R.", bio: "Updated bio", siteLocation: "Lab" });
    expect(edited.status).toBe(200);
    expect(edited.body.phone).toBe("215");
    expect(edited.body.preferredName).toBe("J.R.");

    const [updateAudit] = await db
      .select()
      .from(auditTrail)
      .where(eq(auditTrail.entityId, created.body.id));
    const history = await db.select().from(auditTrail).where(eq(auditTrail.entityId, created.body.id));
    const phoneEdits = history.flatMap((row) => ((row.changes as { edits?: { label: string; from: string; to: string }[] } | null)?.edits ?? [])).filter((edit) => edit.label === "Phone");
    expect(phoneEdits).toEqual(expect.arrayContaining([{ label: "Phone", from: "(blank)", to: "214" }, { label: "Phone", from: "214", to: "215" }]));
    expect(updateAudit).toBeTruthy();
  });

  it("still creates an account from the original fields", async () => {
    const email = `plain.${suffix}@plant.example`;
    const created = await request(app).post("/users").set(auth()).send({
      email,
      password: PASSWORD,
      name: "Plain Person",
      roleId: staffRoleId,
      department: "production",
      managerId: null,
    });
    expect(created.status).toBe(201);
    expect(created.body.mustChangePassword).toBe(true);
    expect(created.body.employeeId).toBeNull();
  });
});

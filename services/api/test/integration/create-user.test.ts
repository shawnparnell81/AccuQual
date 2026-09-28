import { ensureTestCompany } from "../helpers/company.js";
// Add User, as the owner does it from Users & Roles: email, a temporary password,
// a name, a role, a department, and manager left as None. A second account for
// the same inbox, including one that differs only by capital letters, is a
// clear refusal rather than a server error.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { userSites } from "../../src/drizzle/schema/sites.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();
const PASSWORD = "violet-lantern-quarry-88";

let ownerId: number;
let ownerToken: string;
let staffRoleId: number;

describe("create user", () => {
  beforeAll(async () => {
    await ensureTestCompany();
    const [ownerRole] = await db.select().from(roles).where(eq(roles.name, "owner"));
    const [staffRole] = await db.select().from(roles).where(eq(roles.name, "staff"));
    staffRoleId = staffRole!.id;
    const [owner] = await db
      .insert(users)
      .values({ email: `create-user-owner-${suffix}@test.local`, passwordHash: "x", name: "Owner", roleId: ownerRole!.id, mustChangePassword: false })
      .returning();
    ownerId = owner!.id;
    ownerToken = signAccessToken({ sub: String(ownerId), roleId: ownerRole!.id, roleName: "owner", department: null, tv: 0 });
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await pool.end();
  });

  function post(body: Record<string, unknown>) {
    return request(app).post("/users").set("Authorization", `Bearer ${ownerToken}`).send(body);
  }

  it("lets an owner add a person the way the Users & Roles form does", async () => {
    const email = `Jamie.Rivera.${suffix}@YourCompany.com`;
    const created = await post({
      email: `  ${email}  `,
      password: PASSWORD,
      name: "Jamie Rivera",
      roleId: staffRoleId,
      department: "production",
      managerId: null,
    });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe(email.toLowerCase());
    expect(created.body.name).toBe("Jamie Rivera");
    expect(created.body.roleId).toBe(staffRoleId);
    expect(created.body.department).toBe("production");
    expect(created.body.managerId).toBeNull();
    expect(created.body.mustChangePassword).toBe(true);
    expect(created.body.passwordHash).toBeUndefined();
    expect(created.body.currentSiteId).toEqual(expect.any(Number));

    const [membership] = await db.select().from(userSites).where(eq(userSites.userId, created.body.id));
    expect(membership?.siteId).toBe(created.body.currentSiteId);

    const signIn = await request(app).post("/auth/login").send({ email, password: PASSWORD });
    expect(signIn.status).toBe(200);
    expect(signIn.body.user.mustChangePassword).toBe(true);
  });

  it("shows the new person in the user list after they are created", async () => {
    const email = `listed.${suffix}@yourcompany.com`;
    const created = await post({ email, password: PASSWORD, name: "Listed Person", roleId: staffRoleId, managerId: null });
    expect(created.status).toBe(201);
    const list = await request(app).get("/users").set("Authorization", `Bearer ${ownerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.some((row: { email: string }) => row.email === email)).toBe(true);
  });

  it("refuses a second account for the same email, including different capital letters", async () => {
    const email = `pat.lee.${suffix}@yourcompany.com`;
    const first = await post({ email, password: PASSWORD, name: "Pat Lee", roleId: staffRoleId, managerId: null });
    expect(first.status).toBe(201);

    const again = await post({ email, password: PASSWORD, name: "Pat Lee", roleId: staffRoleId, managerId: null });
    expect(again.status).toBe(400);
    expect(again.body.message).toBe("That email is already in use.");

    const differentCase = await post({ email: email.toUpperCase(), password: PASSWORD, name: "Pat Lee", roleId: staffRoleId, managerId: null });
    expect(differentCase.status).toBe(400);
    expect(differentCase.body.message).toBe("That email is already in use.");

    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
  });

  it("asks for a name and a role instead of creating an account without them", async () => {
    const missingName = await post({ email: `noname.${suffix}@yourcompany.com`, password: PASSWORD, roleId: staffRoleId, managerId: null });
    expect(missingName.status).toBe(400);
    expect(missingName.body.message).toBe("Enter a name.");

    const missingRole = await post({ email: `norole.${suffix}@yourcompany.com`, password: PASSWORD, name: "No Role", managerId: null });
    expect(missingRole.status).toBe(400);
    expect(missingRole.body.message).toBe("Choose a role.");
  });

  it("explains a reused admin email, a blank name, and no role in one message", async () => {
    const res = await post({ email: `Create-User-Owner-${suffix}@test.local`, password: PASSWORD, managerId: null });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Enter a name. Choose a role. That email is already in use.");
  });

  it("refuses a role that is not in the list", async () => {
    const res = await post({ email: `nobody.${suffix}@yourcompany.com`, password: PASSWORD, name: "Nobody", roleId: 999999, managerId: null });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("That role doesn't exist.");
  });
});

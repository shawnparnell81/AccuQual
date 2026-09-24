import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { env } from "../../config/env.js";
import { isObviousTestName } from "../../utils/testDataGuard.js";
import { passwordProblem } from "../../utils/passwordPolicy.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { recomputeState } from "../inventory/inventory.service.js";

export type EntityKey = "suppliers" | "inventory_items" | "people";

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  help?: string;
  example?: string;
  /** Other header names that should auto-match this field. */
  aliases?: string[];
}

export interface ImportContext {
  db: TenantDb;
  tenantId: number;
  userId?: number;
}

interface Validated<V> {
  errors: string[];
  value?: V;
  /** Lowercased identity used to catch rows that already exist, or repeat inside the file. */
  identity?: string;
}

export interface Created {
  id: number;
  label: string;
  /** Only ever set for people: a one-time credential handed back to the admin who ran the import. */
  temporaryPassword?: string;
}

export interface ImportEntity<V = Record<string, unknown>, L = unknown> {
  key: EntityKey;
  label: string;
  description: string;
  fields: ImportField[];
  /** Loads what rows are checked against: names that already exist, supplier / role lookups. */
  prepare(ctx: ImportContext, identities: string[]): Promise<L & { existing: Set<string> }>;
  validate(raw: Record<string, string>, lookups: L & { existing: Set<string> }): Validated<V>;
  insert(ctx: ImportContext, value: V, lookups: L & { existing: Set<string> }): Promise<Created>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseNumber(text: string, label: string, errors: string[], opts: { min?: number; integer?: boolean } = {}): number | undefined {
  if (text === "") return undefined;
  const cleaned = text.replace(/[$,\s]/g, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    errors.push(`${label} "${text}" isn't a number.`);
    return undefined;
  }
  if (opts.integer && !Number.isInteger(value)) errors.push(`${label} must be a whole number.`);
  if (opts.min !== undefined && value < opts.min) errors.push(`${label} can't be below ${opts.min}.`);
  return value;
}

// ---------- Suppliers ----------

interface SupplierValue {
  name: string;
  contactEmail?: string;
}

const supplierEntity: ImportEntity<SupplierValue> = {
  key: "suppliers",
  label: "Suppliers",
  description: "Add suppliers in bulk. Each one starts as an active supplier, the same as adding it by hand.",
  fields: [
    { key: "name", label: "Supplier name", required: true, example: "Acme Fasteners", aliases: ["supplier", "vendor", "vendor name", "company", "name"] },
    { key: "contactEmail", label: "Contact email", example: "sales@acmefasteners.com", aliases: ["email", "contact", "e-mail"] },
  ],
  async prepare(ctx) {
    const rows = await ctx.db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.tenantId, ctx.tenantId));
    return { existing: new Set(rows.map((r) => r.name.trim().toLowerCase())) };
  },
  validate(raw) {
    const errors: string[] = [];
    const name = raw.name?.trim() ?? "";
    if (!name) errors.push("Supplier name is required.");
    if (name.length > 200) errors.push("Supplier name is longer than 200 characters.");
    const contactEmail = raw.contactEmail?.trim();
    if (contactEmail && !EMAIL.test(contactEmail)) errors.push(`Contact email "${contactEmail}" doesn't look like an email address.`);
    return { errors, value: errors.length ? undefined : { name, contactEmail: contactEmail || undefined }, identity: name.toLowerCase() };
  },
  async insert(ctx, value) {
    const [created] = await ctx.db.insert(suppliers).values({ tenantId: ctx.tenantId, name: value.name, contactEmail: value.contactEmail }).returning();
    await recordAuditTrail(ctx.db, { tenantId: ctx.tenantId, entityType: "Supplier", entityId: created!.id, action: "create", changes: { ...value, source: "excel_import" }, performedBy: ctx.userId });
    return { id: created!.id, label: created!.name };
  },
};

// ---------- Inventory items ----------

interface ItemValue {
  sku: string;
  description?: string;
  itemType: "raw_material" | "wip" | "finished_good";
  unitOfMeasure?: string;
  defaultSupplierId?: number;
  minLevel: number;
  maxLevel?: number;
  reorderQuantity?: number;
  leadTimeDays?: number;
  unitCost?: number;
  notes?: string;
}

const ITEM_TYPES: Record<string, ItemValue["itemType"]> = {
  rawmaterial: "raw_material",
  raw: "raw_material",
  rm: "raw_material",
  material: "raw_material",
  wip: "wip",
  workinprogress: "wip",
  finishedgood: "finished_good",
  finishedgoods: "finished_good",
  fg: "finished_good",
  finished: "finished_good",
};

const itemEntity: ImportEntity<ItemValue, { suppliersByName: Map<string, number> }> = {
  key: "inventory_items",
  label: "Inventory items",
  description: "Add inventory items (part numbers) in bulk. Stock counts aren't imported here; they're recorded as movements.",
  fields: [
    { key: "sku", label: "SKU / part number", required: true, example: "FST-0042", aliases: ["sku", "part number", "part no", "part #", "item number", "item", "material"] },
    { key: "description", label: "Description", example: "M6 hex bolt, zinc plated", aliases: ["desc", "item description", "name"] },
    { key: "itemType", label: "Type", help: "Raw material, WIP or Finished good. Blank means raw material.", example: "Raw material", aliases: ["item type", "category", "class"] },
    { key: "unitOfMeasure", label: "Unit of measure", example: "EA", aliases: ["uom", "unit", "units"] },
    { key: "supplier", label: "Default supplier", help: "Must match a supplier that already exists (import suppliers first).", example: "Acme Fasteners", aliases: ["vendor", "default supplier", "supplier name"] },
    { key: "minLevel", label: "Minimum level", help: "Blank means 0.", example: "100", aliases: ["min", "minimum", "min qty", "reorder point"] },
    { key: "maxLevel", label: "Maximum level", example: "1000", aliases: ["max", "maximum", "max qty"] },
    { key: "reorderQuantity", label: "Reorder quantity", example: "500", aliases: ["reorder qty", "order qty", "eoq"] },
    { key: "leadTimeDays", label: "Lead time (days)", example: "14", aliases: ["lead time", "leadtime"] },
    { key: "unitCost", label: "Unit cost", example: "0.12", aliases: ["cost", "price", "unit price", "standard cost"] },
    { key: "notes", label: "Notes", aliases: ["comments", "note"] },
  ],
  async prepare(ctx, identities) {
    const existing = new Set<string>();
    for (let i = 0; i < identities.length; i += 500) {
      const chunk = identities.slice(i, i + 500);
      if (chunk.length === 0) continue;
      const found = await ctx.db.select({ sku: inventoryItems.sku }).from(inventoryItems).where(and(eq(inventoryItems.tenantId, ctx.tenantId), inArray(sql`lower(${inventoryItems.sku})`, chunk)));
      for (const row of found) existing.add(row.sku.trim().toLowerCase());
    }
    const supplierRows = await ctx.db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.tenantId, ctx.tenantId));
    return { existing, suppliersByName: new Map(supplierRows.map((s) => [s.name.trim().toLowerCase(), s.id])) };
  },
  validate(raw, lookups) {
    const errors: string[] = [];
    const sku = raw.sku?.trim() ?? "";
    if (!sku) errors.push("SKU / part number is required.");
    if (sku.length > 100) errors.push("SKU is longer than 100 characters.");
    if (sku && env.NODE_ENV === "production" && isObviousTestName(sku)) errors.push(`SKU "${sku}" looks like test data and can't be created in production.`);

    let itemType: ItemValue["itemType"] = "raw_material";
    const typeText = raw.itemType?.trim();
    if (typeText) {
      const mapped = ITEM_TYPES[typeText.toLowerCase().replace(/[\s_-]+/g, "")];
      if (!mapped) errors.push(`Type "${typeText}" isn't recognized. Use Raw material, WIP or Finished good.`);
      else itemType = mapped;
    }

    let defaultSupplierId: number | undefined;
    const supplierText = raw.supplier?.trim();
    if (supplierText) {
      defaultSupplierId = lookups.suppliersByName.get(supplierText.toLowerCase());
      if (defaultSupplierId === undefined) errors.push(`Supplier "${supplierText}" doesn't exist yet. Import or add the supplier first.`);
    }

    const minLevel = parseNumber(raw.minLevel ?? "", "Minimum level", errors, { min: 0 }) ?? 0;
    const maxLevel = parseNumber(raw.maxLevel ?? "", "Maximum level", errors, { min: 0 });
    const reorderQuantity = parseNumber(raw.reorderQuantity ?? "", "Reorder quantity", errors, { min: 0 });
    const leadTimeDays = parseNumber(raw.leadTimeDays ?? "", "Lead time", errors, { min: 0, integer: true });
    const unitCost = parseNumber(raw.unitCost ?? "", "Unit cost", errors, { min: 0 });
    if (maxLevel !== undefined && maxLevel < minLevel) errors.push("Maximum level is below the minimum level.");

    const value: ItemValue = {
      sku,
      description: raw.description?.trim() || undefined,
      itemType,
      unitOfMeasure: raw.unitOfMeasure?.trim() || undefined,
      defaultSupplierId,
      minLevel,
      maxLevel,
      reorderQuantity,
      leadTimeDays,
      unitCost,
      notes: raw.notes?.trim() || undefined,
    };
    return { errors, value: errors.length ? undefined : value, identity: sku.toLowerCase() };
  },
  async insert(ctx, value) {
    const [created] = await ctx.db
      .insert(inventoryItems)
      .values({ ...value, minLevel: String(value.minLevel), maxLevel: value.maxLevel?.toString(), reorderQuantity: value.reorderQuantity?.toString(), unitCost: value.unitCost?.toString(), tenantId: ctx.tenantId })
      .returning();
    await recordAuditTrail(ctx.db, { tenantId: ctx.tenantId, entityType: "InventoryItem", entityId: created!.id, action: "create", changes: { ...value, source: "excel_import" }, performedBy: ctx.userId });
    await recomputeState(ctx.db, ctx.tenantId, created!.id, ctx.userId);
    return { id: created!.id, label: created!.sku };
  },
};

// ---------- People ----------

interface PersonValue {
  email: string;
  name?: string;
  roleId?: number;
  department?: string;
}

const DEPARTMENTS = ["quality", "engineering", "production", "customer_service", "purchasing", "material_management", "sales_and_marketing"];
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generateTemporaryPassword(email: string, name?: string): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const group = () => Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    const candidate = `${group()}-${group()}-${group()}-${randomInt(10, 100)}`;
    if (!passwordProblem(candidate, { email, name })) return candidate;
  }
  throw new Error("Couldn't generate an acceptable temporary password.");
}

const peopleEntity: ImportEntity<PersonValue, { rolesByName: Map<string, number> }> = {
  key: "people",
  label: "People",
  description: "Create user accounts in bulk. Each person gets a one-time temporary password that you hand out; they can change it after signing in. Admins only.",
  fields: [
    { key: "email", label: "Email", required: true, example: "jamie@yourcompany.com", aliases: ["e-mail", "email address", "work email"] },
    { key: "name", label: "Full name", example: "Jamie Rivera", aliases: ["name", "employee", "employee name", "person"] },
    { key: "role", label: "Role", help: "Must match an existing role name (for example operator, quality_manager, auditor). Blank means no role yet.", example: "operator", aliases: ["job role", "access", "access level"] },
    { key: "department", label: "Department", help: "Quality, Engineering, Production, Customer Service, Purchasing, Material Management or Sales & Marketing.", example: "Production", aliases: ["dept", "team", "area"] },
  ],
  async prepare(ctx, identities) {
    const existing = new Set<string>();
    for (let i = 0; i < identities.length; i += 500) {
      const chunk = identities.slice(i, i + 500);
      if (chunk.length === 0) continue;
      const found = await ctx.db.select({ email: users.email }).from(users).where(inArray(sql`lower(${users.email})`, chunk));
      for (const row of found) existing.add(row.email.toLowerCase());
    }
    const roleRows = await ctx.db.select({ id: roles.id, name: roles.name }).from(roles);
    return { existing, rolesByName: new Map(roleRows.map((r) => [r.name.trim().toLowerCase(), r.id])) };
  },
  validate(raw, lookups) {
    const errors: string[] = [];
    const email = raw.email?.trim() ?? "";
    if (!email) errors.push("Email is required.");
    else if (!EMAIL.test(email)) errors.push(`"${email}" doesn't look like an email address.`);

    let roleId: number | undefined;
    const roleText = raw.role?.trim();
    if (roleText) {
      roleId = lookups.rolesByName.get(roleText.toLowerCase().replace(/\s+/g, "_")) ?? lookups.rolesByName.get(roleText.toLowerCase());
      if (roleId === undefined) errors.push(`Role "${roleText}" doesn't exist.`);
      else if (["admin", "platform_admin"].includes(roleText.toLowerCase())) errors.push("Admin accounts can't be created by import. Add them one at a time.");
    }

    let department: string | undefined;
    const deptText = raw.department?.trim();
    if (deptText) {
      const key = deptText.toLowerCase().replace(/&/g, "and").replace(/[\s-]+/g, "_").replace(/^sales_and_marketing$/, "sales_and_marketing").replace(/^material_mgmt$/, "material_management");
      const match = DEPARTMENTS.find((d) => d === key) ?? DEPARTMENTS.find((d) => d.replace(/_/g, "") === key.replace(/_/g, ""));
      if (!match) errors.push(`Department "${deptText}" isn't one of the app's departments.`);
      else department = match;
    }

    const value: PersonValue = { email, name: raw.name?.trim() || undefined, roleId, department };
    return { errors, value: errors.length ? undefined : value, identity: email.toLowerCase() };
  },
  async insert(ctx, value) {
    const temporaryPassword = generateTemporaryPassword(value.email, value.name);
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const [created] = await ctx.db
      .insert(users)
      .values({ email: value.email, passwordHash, name: value.name, roleId: value.roleId, department: value.department, tenantId: ctx.tenantId, passwordChangedAt: new Date() })
      .returning();
    await recordAuditTrail(ctx.db, { tenantId: ctx.tenantId, entityType: "User", entityId: created!.id, action: "create", changes: { email: value.email, roleId: value.roleId, department: value.department, source: "excel_import" }, performedBy: ctx.userId });
    return { id: created!.id, label: value.email, temporaryPassword };
  },
};

type Lookups = { existing: Set<string> } & Record<string, unknown>;

/** The shape the controller works with — each entity's own value/lookup types are internal to it. */
export interface AnyImportEntity {
  key: EntityKey;
  label: string;
  description: string;
  fields: ImportField[];
  prepare(ctx: ImportContext, identities: string[]): Promise<Lookups>;
  validate(raw: Record<string, string>, lookups: Lookups): Validated<unknown>;
  insert(ctx: ImportContext, value: unknown, lookups: Lookups): Promise<Created>;
}

export const IMPORT_ENTITIES: Record<EntityKey, AnyImportEntity> = {
  suppliers: supplierEntity as unknown as AnyImportEntity,
  inventory_items: itemEntity as unknown as AnyImportEntity,
  people: peopleEntity as unknown as AnyImportEntity,
};

export function getImportEntity(key: string): AnyImportEntity | undefined {
  return (IMPORT_ENTITIES as Record<string, AnyImportEntity>)[key];
}

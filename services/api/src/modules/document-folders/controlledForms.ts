import { and, eq, isNull } from "drizzle-orm";
import { controlledFormLinks, controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import type { Db } from "../../lib/requestDb.js";

export interface ControlledFormPlacement {
  parentName: string | null;
  folderName: string;
}

export interface ControlledFormSeed {
  formKey: string;
  docId: string;
  title: string;
  route: string;
  folders: ControlledFormPlacement[];
  categories: string[];
}

/**
 * The controlled templates filed in more than one folder. Add a row here
 * for the next form (internal audit checklist, quarantine notice,
 * concession/deviation, training record) and it shows up in the Forms
 * Library, ISO Compliance, and whatever subject folders are listed.
 */
export const CONTROLLED_FORM_SEEDS: ControlledFormSeed[] = [
  {
    formKey: "frm-val-001",
    docId: "FRM-VAL-001",
    title: "CSA Validation Report",
    route: "/folders/validation-reports",
    folders: [
      { parentName: "ISO Compliance", folderName: "Controlled Forms" },
      { parentName: "Quality", folderName: "Validation Reports" },
    ],
    categories: ["validation-reports"],
  },
  {
    formKey: "frm-val-007",
    docId: "FRM-VAL-007",
    title: "Fuel Pump Validation",
    route: "/folders/validation-reports",
    folders: [
      { parentName: "ISO Compliance", folderName: "Controlled Forms" },
      { parentName: "Quality", folderName: "Validation Reports" },
    ],
    categories: ["validation-reports"],
  },
];

async function findOrCreateRoot(db: Db, name: string) {
  const [existing] = await db.select().from(documentFolders).where(and(isNull(documentFolders.parentId), eq(documentFolders.name, name)));
  if (existing) return existing;
  const siblings = await db.select().from(documentFolders).where(isNull(documentFolders.parentId));
  const [created] = await db.insert(documentFolders).values({ name, sortOrder: siblings.length }).returning();
  if (!created) throw new Error(`Could not create the ${name} folder`);
  return created;
}

async function findOrCreateChild(db: Db, parentId: number, name: string) {
  const [existing] = await db.select().from(documentFolders).where(and(eq(documentFolders.parentId, parentId), eq(documentFolders.name, name)));
  if (existing) return existing;
  const siblings = await db.select().from(documentFolders).where(eq(documentFolders.parentId, parentId));
  const [created] = await db.insert(documentFolders).values({ name, parentId, sortOrder: siblings.length }).returning();
  if (!created) throw new Error(`Could not create the ${name} folder`);
  return created;
}

/** Inserts missing folders, templates, and links. Does not remove anything. */
export async function ensureControlledForms(db: Db): Promise<void> {
  const iso = await findOrCreateRoot(db, "ISO Compliance");
  await findOrCreateChild(db, iso.id, "Controlled Forms");

  const [quality] = await db.select().from(documentFolders).where(and(isNull(documentFolders.parentId), eq(documentFolders.name, "Quality")));
  if (quality) await findOrCreateChild(db, quality.id, "Validation Reports");

  for (const seed of CONTROLLED_FORM_SEEDS) {
    const [existing] = await db.select().from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, seed.formKey));
    const template = existing ?? (await db.insert(controlledFormTemplates).values({
      formKey: seed.formKey,
      docId: seed.docId,
      title: seed.title,
      route: seed.route,
    }).returning())[0];
    if (!template) continue;

    const links = await db.select().from(controlledFormLinks).where(eq(controlledFormLinks.templateId, template.id));
    const linkedFolders = new Set(links.map((link) => link.folderId).filter((id): id is number => id !== null));
    const linkedCategories = new Set(links.map((link) => link.categoryKey).filter((key): key is string => !!key));

    for (const placement of seed.folders) {
      const [parent] = placement.parentName
        ? await db.select().from(documentFolders).where(and(isNull(documentFolders.parentId), eq(documentFolders.name, placement.parentName)))
        : [null];
      if (!parent) continue;
      const [folder] = await db.select().from(documentFolders).where(and(eq(documentFolders.parentId, parent.id), eq(documentFolders.name, placement.folderName)));
      if (!folder || linkedFolders.has(folder.id)) continue;
      await db.insert(controlledFormLinks).values({ templateId: template.id, folderId: folder.id });
      linkedFolders.add(folder.id);
    }

    for (const categoryKey of seed.categories) {
      if (linkedCategories.has(categoryKey)) continue;
      await db.insert(controlledFormLinks).values({ templateId: template.id, categoryKey });
    }
  }
}

export interface ControlledFormView {
  id: number;
  formKey: string;
  docId: string;
  title: string;
  route: string;
  folderIds: number[];
  categoryKeys: string[];
}

export async function listControlledForms(db: Db): Promise<ControlledFormView[]> {
  await ensureControlledForms(db);
  const templates = await db.select().from(controlledFormTemplates);
  const links = await db.select().from(controlledFormLinks);
  return templates
    .map((template) => {
      const mine = links.filter((link) => link.templateId === template.id);
      return {
        id: template.id,
        formKey: template.formKey,
        docId: template.docId,
        title: template.title,
        route: template.route,
        folderIds: mine.map((link) => link.folderId).filter((id): id is number => id !== null),
        categoryKeys: mine.map((link) => link.categoryKey).filter((key): key is string => !!key),
      };
    })
    .sort((a, b) => a.docId.localeCompare(b.docId));
}

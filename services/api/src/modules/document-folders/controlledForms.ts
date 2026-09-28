import { and, eq, isNull } from "drizzle-orm";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import type { Db } from "../../lib/requestDb.js";

export interface ControlledFormSeed {
  formKey: string;
  docId: string;
  title: string;
  /** Subject folder where a filled-in record is started and filed. */
  route: string;
  /** Topic subfolder under the ISO Compliance document folder. */
  topic: string;
}

/**
 * Blank templates. Each one has a single home under ISO Compliance.
 * Add a row here for the next form (internal audit checklist, quarantine
 * notice, concession/deviation, training record) and name its topic folder.
 * The Forms Library lists these same rows. Filled records are stored by
 * the subject module, not copied into another folder.
 */
export const CONTROLLED_FORM_SEEDS: ControlledFormSeed[] = [
  {
    formKey: "frm-val-001",
    docId: "FRM-VAL-001",
    title: "CSA Validation Report",
    route: "/folders/validation-reports",
    topic: "Validation",
  },
  {
    formKey: "frm-val-007",
    docId: "FRM-VAL-007",
    title: "Fuel Pump Validation",
    route: "/folders/validation-reports",
    topic: "Validation",
  },
];

const ISO_COMPLIANCE = "ISO Compliance";

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

/** Drops a folder left over from the multi-link filing, when nothing is in it. */
async function removeEmptyChild(db: Db, parentId: number, name: string) {
  const [folder] = await db.select().from(documentFolders).where(and(eq(documentFolders.parentId, parentId), eq(documentFolders.name, name)));
  if (!folder || folder.pdfPath || folder.documentId || folder.linkedPath) return;
  const children = await db.select({ id: documentFolders.id }).from(documentFolders).where(eq(documentFolders.parentId, folder.id));
  if (children.length > 0) return;
  const [held] = await db.select({ id: controlledFormTemplates.id }).from(controlledFormTemplates).where(eq(controlledFormTemplates.folderId, folder.id));
  if (held) return;
  await db.delete(documentFolders).where(eq(documentFolders.id, folder.id));
}

/**
 * One home per blank template: ISO Compliance, then a topic subfolder.
 * Corrects databases that still have the earlier multi-folder links by
 * pointing each template at that single folder and removing the empty
 * folders that only existed to hold the extra copies.
 */
export async function ensureControlledForms(db: Db): Promise<void> {
  const iso = await findOrCreateRoot(db, ISO_COMPLIANCE);
  const topics = new Map<string, number>();

  for (const seed of CONTROLLED_FORM_SEEDS) {
    let topicId = topics.get(seed.topic);
    if (topicId === undefined) {
      topicId = (await findOrCreateChild(db, iso.id, seed.topic)).id;
      topics.set(seed.topic, topicId);
    }

    const [existing] = await db.select().from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, seed.formKey));
    if (!existing) {
      await db.insert(controlledFormTemplates).values({
        formKey: seed.formKey,
        docId: seed.docId,
        title: seed.title,
        route: seed.route,
        folderId: topicId,
      });
      continue;
    }
    if (existing.folderId !== topicId || existing.docId !== seed.docId || existing.title !== seed.title || existing.route !== seed.route) {
      await db.update(controlledFormTemplates).set({
        docId: seed.docId,
        title: seed.title,
        route: seed.route,
        folderId: topicId,
      }).where(eq(controlledFormTemplates.id, existing.id));
    }
  }

  await removeEmptyChild(db, iso.id, "Controlled Forms");
  const [quality] = await db.select().from(documentFolders).where(and(isNull(documentFolders.parentId), eq(documentFolders.name, "Quality")));
  if (quality) await removeEmptyChild(db, quality.id, "Validation Reports");
}

export interface ControlledFormView {
  id: number;
  formKey: string;
  docId: string;
  title: string;
  route: string;
  folderId: number | null;
}

export async function listControlledForms(db: Db): Promise<ControlledFormView[]> {
  await ensureControlledForms(db);
  const templates = await db.select().from(controlledFormTemplates);
  return templates
    .map((template) => ({
      id: template.id,
      formKey: template.formKey,
      docId: template.docId,
      title: template.title,
      route: template.route,
      folderId: template.folderId,
    }))
    .sort((a, b) => a.docId.localeCompare(b.docId));
}

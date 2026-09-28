import { and, eq, isNull } from "drizzle-orm";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import type { Db } from "../../lib/requestDb.js";
import { FILE_NAME_PATTERN, FORM_TEMPLATES } from "./formFiling.js";

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

/** Files each blank template in its one ISO Compliance topic folder. */
export async function ensureFormTemplates(db: Db): Promise<void> {
  const iso = await findOrCreateRoot(db, ISO_COMPLIANCE);
  const folders = new Map<string, number>();

  for (const seed of FORM_TEMPLATES) {
    const key = seed.isoPath.join("/");
    let folderId = folders.get(key);
    if (folderId === undefined) {
      let parentId = iso.id;
      for (const name of seed.isoPath) {
        parentId = (await findOrCreateChild(db, parentId, name)).id;
      }
      folderId = parentId;
      folders.set(key, folderId);
    }

    const [existing] = await db.select().from(controlledFormTemplates).where(eq(controlledFormTemplates.formKey, seed.formKey));
    if (!existing) {
      await db.insert(controlledFormTemplates).values({
        formKey: seed.formKey,
        formId: seed.formId,
        title: seed.title,
        subjectRoute: seed.subjectRoute,
        folderId,
      });
      continue;
    }
    if (existing.folderId !== folderId || existing.formId !== seed.formId || existing.title !== seed.title || existing.subjectRoute !== seed.subjectRoute) {
      await db.update(controlledFormTemplates).set({
        formId: seed.formId,
        title: seed.title,
        subjectRoute: seed.subjectRoute,
        folderId,
      }).where(eq(controlledFormTemplates.id, existing.id));
    }
  }

  const [strayValidation] = await db.select().from(documentFolders).where(and(eq(documentFolders.parentId, iso.id), eq(documentFolders.name, "Validation")));
  if (strayValidation && !strayValidation.pdfPath && !strayValidation.documentId && !strayValidation.linkedPath) {
    const children = await db.select({ id: documentFolders.id }).from(documentFolders).where(eq(documentFolders.parentId, strayValidation.id));
    const [held] = await db.select({ id: controlledFormTemplates.id }).from(controlledFormTemplates).where(eq(controlledFormTemplates.folderId, strayValidation.id));
    if (children.length === 0 && !held) await db.delete(documentFolders).where(eq(documentFolders.id, strayValidation.id));
  }
}

export interface FormTemplateView {
  id: number;
  formKey: string;
  formId: string;
  title: string;
  subjectRoute: string;
  folderId: number | null;
  isoPath: string[];
}

export async function listFormTemplates(db: Db): Promise<{ fileNamePattern: string; templates: FormTemplateView[] }> {
  await ensureFormTemplates(db);
  const templates = await db.select().from(controlledFormTemplates);
  const folders = await db.select().from(documentFolders);
  const byId = new Map(folders.map((folder) => [folder.id, folder]));

  function pathOf(folderId: number | null): string[] {
    const names: string[] = [];
    let current = folderId === null ? undefined : byId.get(folderId);
    while (current && current.name !== ISO_COMPLIANCE) {
      names.unshift(current.name);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return names;
  }

  return {
    fileNamePattern: FILE_NAME_PATTERN,
    templates: templates
      .map((template) => ({
        id: template.id,
        formKey: template.formKey,
        formId: template.formId,
        title: template.title,
        subjectRoute: template.subjectRoute,
        folderId: template.folderId,
        isoPath: pathOf(template.folderId),
      }))
      .sort((a, b) => a.formId.localeCompare(b.formId)),
  };
}

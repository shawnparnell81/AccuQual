import { and, eq, isNull } from "drizzle-orm";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import type { Db } from "../../lib/requestDb.js";
import { BLANK_FORMS_FOLDER, FILE_NAME_PATTERN, FORM_TEMPLATES, ISO_DOCUMENTS_FOLDER, templateFolderPath } from "./formFiling.js";

const PREVIOUS_ISO_ROOT = "ISO Compliance";
const PREVIOUS_BLANK_FOLDER = "03_Blank_Forms_Templates";

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

/** Files each blank template under ISO Compliance Documents / Blank Form Templates / topic. */
export async function ensureFormTemplates(db: Db): Promise<void> {
  const [legacy] = await db.select().from(documentFolders).where(and(isNull(documentFolders.parentId), eq(documentFolders.name, PREVIOUS_ISO_ROOT)));
  const [named] = await db.select().from(documentFolders).where(and(isNull(documentFolders.parentId), eq(documentFolders.name, ISO_DOCUMENTS_FOLDER)));
  if (legacy && !named) {
    await db.update(documentFolders).set({ name: ISO_DOCUMENTS_FOLDER }).where(eq(documentFolders.id, legacy.id));
  }

  const iso = await findOrCreateRoot(db, ISO_DOCUMENTS_FOLDER);
  const [previousBlanks] = await db.select().from(documentFolders).where(and(eq(documentFolders.parentId, iso.id), eq(documentFolders.name, PREVIOUS_BLANK_FOLDER)));
  const [currentBlanks] = await db.select().from(documentFolders).where(and(eq(documentFolders.parentId, iso.id), eq(documentFolders.name, BLANK_FORMS_FOLDER)));
  if (previousBlanks && !currentBlanks) {
    await db.update(documentFolders).set({ name: BLANK_FORMS_FOLDER }).where(eq(documentFolders.id, previousBlanks.id));
  }
  const blanks = await findOrCreateChild(db, iso.id, BLANK_FORMS_FOLDER);
  const keep = new Set<number>([blanks.id]);

  const folders = new Map<string, number>();

  for (const seed of FORM_TEMPLATES) {
    const key = seed.topic;
    let folderId = folders.get(key);
    if (folderId === undefined) {
      let parentId = iso.id;
      for (const name of templateFolderPath(seed.topic)) {
        parentId = (await findOrCreateChild(db, parentId, name)).id;
      }
      folderId = parentId;
      folders.set(key, folderId);
      keep.add(folderId);
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

  await pruneEmptyDescendants(db, iso.id, keep);
}

async function pruneEmptyDescendants(db: Db, rootId: number, keep: Set<number>): Promise<void> {
  const all = await db.select().from(documentFolders);
  const childrenOf = new Map<number, number[]>();
  for (const folder of all) {
    if (folder.parentId === null) continue;
    const list = childrenOf.get(folder.parentId) ?? [];
    list.push(folder.id);
    childrenOf.set(folder.parentId, list);
  }
  const byId = new Map(all.map((folder) => [folder.id, folder]));
  const descendants: number[] = [];
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;
    descendants.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  const depthOf = (id: number) => {
    let depth = 0;
    let current = byId.get(id);
    while (current?.parentId != null) {
      depth += 1;
      current = byId.get(current.parentId);
    }
    return depth;
  };
  descendants.sort((a, b) => depthOf(b) - depthOf(a));
  const removed = new Set<number>();
  for (const id of descendants) {
    if (keep.has(id) || removed.has(id)) continue;
    const folder = byId.get(id);
    if (!folder || folder.pdfPath || folder.documentId || folder.linkedPath) continue;
    const liveChildren = (childrenOf.get(id) ?? []).filter((childId) => !removed.has(childId));
    if (liveChildren.length > 0) continue;
    const [held] = await db.select({ id: controlledFormTemplates.id }).from(controlledFormTemplates).where(eq(controlledFormTemplates.folderId, id));
    if (held) continue;
    await db.delete(documentFolders).where(eq(documentFolders.id, id));
    removed.add(id);
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
    while (current && current.name !== ISO_DOCUMENTS_FOLDER) {
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

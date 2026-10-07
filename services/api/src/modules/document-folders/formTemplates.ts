import { and, eq, inArray, isNull } from "drizzle-orm";
import { company } from "../../drizzle/schema/company.js";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import type { Db } from "../../lib/requestDb.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import {
  BLANK_FORMS_FOLDER,
  FILE_NAME_PATTERN,
  FORM_TEMPLATES,
  ISO_DOCUMENTS_FOLDER,
  PREVIOUS_BLANK_FORMS_FOLDER,
  RETIRED_FORM_KEYS,
  blankTemplateLabel,
  blankTemplateStartPath,
  fileNamePatternFor,
  keptOutOfBlankFormsTemplates,
  storedFormId,
  type FormStart,
  type FormTemplateSeed,
} from "./formFiling.js";
import { ensureMainIsoFolders, folderLocationLabel } from "./mainIsoFolders.js";

const PREVIOUS_ISO_ROOT = "ISO Compliance";
const PREVIOUS_NUMBERED_BLANK_FOLDER = "03_Blank_Forms_Templates";
const FOLDER_AUDIT = "DocumentFolder";

type FolderRow = typeof documentFolders.$inferSelect;

async function findOrCreateRoot(db: Db, name: string) {
  const [existing] = await db.select().from(documentFolders).where(and(isNull(documentFolders.parentId), eq(documentFolders.name, name)));
  if (existing) return existing;
  const siblings = await db.select().from(documentFolders).where(isNull(documentFolders.parentId));
  const [created] = await db.insert(documentFolders).values({ name, sortOrder: siblings.length }).returning();
  if (!created) throw new Error(`Could not create the ${name} folder`);
  return created;
}

async function findOrCreateChild(db: Db, parentId: number, name: string, sortOrder?: number) {
  const [existing] = await db.select().from(documentFolders).where(and(eq(documentFolders.parentId, parentId), eq(documentFolders.name, name)));
  if (existing) return existing;
  const siblings = await db.select().from(documentFolders).where(eq(documentFolders.parentId, parentId));
  const [created] = await db.insert(documentFolders).values({ name, parentId, sortOrder: sortOrder ?? siblings.length }).returning();
  if (!created) throw new Error(`Could not create the ${name} folder`);
  return created;
}

function remember(all: FolderRow[], row: FolderRow) {
  const index = all.findIndex((folder) => folder.id === row.id);
  if (index >= 0) all[index] = row;
  else all.push(row);
}

function insideFolder(byId: Map<number, FolderRow>, folderId: number, ancestorId: number): boolean {
  let current = byId.get(folderId);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.id === ancestorId) return true;
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return false;
}

function sameKeys(left: string[] | undefined, right: string[]): boolean {
  if (!left || left.length !== right.length) return false;
  const sorted = [...left].sort();
  return sorted.every((key, index) => key === right[index]);
}

/**
 * Files each fillable blank under ISO Compliance Documents / Blank Forms Templates / topic
 * once per company. A shortcut Shawn moves, renames, or deletes stays that way.
 * A form key added later is filed there the first time it appears.
 *
 * Master Document List, Master Equipment List, and Scope of Laboratory Activities
 * are not part of that filing. They keep the older Blank Form Templates drawer.
 */
export async function ensureFormTemplates(db: Db, performedBy?: number): Promise<void> {
  if (RETIRED_FORM_KEYS.length > 0) {
    await db.delete(controlledFormTemplates).where(inArray(controlledFormTemplates.formKey, [...RETIRED_FORM_KEYS]));
  }
  const all = await db.select().from(documentFolders);

  const legacyIso = all.find((folder) => folder.parentId === null && folder.name === PREVIOUS_ISO_ROOT);
  const namedIso = all.find((folder) => folder.name === ISO_DOCUMENTS_FOLDER);
  if (legacyIso && !namedIso) {
    await db.update(documentFolders).set({ name: ISO_DOCUMENTS_FOLDER }).where(eq(documentFolders.id, legacyIso.id));
    legacyIso.name = ISO_DOCUMENTS_FOLDER;
  }

  let iso = all.find((folder) => folder.parentId === null && folder.name === ISO_DOCUMENTS_FOLDER);
  if (!iso) {
    iso = all.find((folder) => folder.name === ISO_DOCUMENTS_FOLDER) ?? (await findOrCreateRoot(db, ISO_DOCUMENTS_FOLDER));
    remember(all, iso);
  }

  const numbered = all.find((folder) => folder.parentId === iso.id && folder.name === PREVIOUS_NUMBERED_BLANK_FOLDER);
  const singularNamed = all.find((folder) => folder.name === PREVIOUS_BLANK_FORMS_FOLDER);
  if (numbered && !singularNamed) {
    await db.update(documentFolders).set({ name: PREVIOUS_BLANK_FORMS_FOLDER }).where(eq(documentFolders.id, numbered.id));
    numbered.name = PREVIOUS_BLANK_FORMS_FOLDER;
  }

  const withMain = await ensureMainIsoFolders(db, all);
  for (const folder of withMain) remember(all, folder);

  const [profileRow] = await db.select({ id: company.id, profile: company.profile }).from(company).limit(1);
  const ready = profileRow?.profile?.blankFormsTemplatesReady === true;
  const placed = new Set(profileRow?.profile?.blankFormKeysPlaced ?? []);
  const storedHomeId = profileRow?.profile?.blankFormsTemplatesFolderId;

  const fillableSeeds = FORM_TEMPLATES.filter((seed) => !keptOutOfBlankFormsTemplates(seed));
  const incoming = fillableSeeds.filter((seed) => !placed.has(seed.formKey));
  const needsHome = !ready || incoming.length > 0;

  let home = storedHomeId != null ? all.find((folder) => folder.id === storedHomeId) : undefined;
  if (!home) home = all.find((folder) => folder.parentId === iso.id && folder.name === BLANK_FORMS_FOLDER);
  if (!home && needsHome) {
    home = await findOrCreateChild(db, iso.id, BLANK_FORMS_FOLDER);
    remember(all, home);
  }

  const saved = await db.select().from(controlledFormTemplates);
  const savedByKey = new Map(saved.map((row) => [row.formKey, row]));
  const byId = () => new Map(all.map((folder) => [folder.id, folder]));
  const excludedFolderIds = new Set(
    saved.filter((row) => keptOutOfBlankFormsTemplates(row) && row.folderId != null).map((row) => row.folderId!),
  );

  const legacy = all.find((folder) => folder.parentId === iso.id && folder.name === PREVIOUS_BLANK_FORMS_FOLDER && folder.id !== home?.id);
  if (!ready && legacy && home && legacy.id !== home.id) {
    for (const child of all.filter((folder) => folder.parentId === legacy.id)) {
      if (excludedFolderIds.has(child.id)) continue;
      if (all.some((folder) => folder.parentId === home!.id && folder.name === child.name)) continue;
      await db.update(documentFolders).set({ parentId: home.id, updatedAt: new Date() }).where(eq(documentFolders.id, child.id));
      child.parentId = home.id;
    }
  }

  const topicFolder = new Map<string, number>();
  for (const seed of fillableSeeds) {
    const existing = savedByKey.get(seed.formKey);
    if (existing?.folderId == null || !byId().has(existing.folderId) || excludedFolderIds.has(existing.folderId)) continue;
    if (topicFolder.has(seed.topic)) continue;
    const inHome = home != null && insideFolder(byId(), existing.folderId, home.id);
    // Before the one-time filing, only a topic already on the new shelf is reused.
    // After that, a topic Shawn moved stays the home for a new form in that topic.
    if (!ready && !inHome) continue;
    topicFolder.set(seed.topic, existing.folderId);
  }

  const topics = [...new Set(fillableSeeds.map((seed) => seed.topic))].sort((a, b) => a.localeCompare(b));
  if (home) {
    let topicOrder = 0;
    for (const topic of topics) {
      const needsTopic = fillableSeeds.some((seed) => seed.topic === topic && (!ready || !placed.has(seed.formKey) || topicFolder.get(topic) != null));
      if (!topicFolder.has(topic) && needsTopic && (!ready || fillableSeeds.some((seed) => seed.topic === topic && !placed.has(seed.formKey)))) {
        const created = await findOrCreateChild(db, home.id, topic, topicOrder);
        remember(all, created);
        topicFolder.set(topic, created.id);
      }
      topicOrder += 1;
    }
    if (!ready) {
      let order = 0;
      for (const topic of topics) {
        const row = all.find((folder) => folder.parentId === home!.id && folder.name === topic && !folder.linkedPath);
        if (!row) continue;
        if (row.sortOrder !== order) {
          await db.update(documentFolders).set({ sortOrder: order, updatedAt: new Date() }).where(eq(documentFolders.id, row.id));
          row.sortOrder = order;
        }
        order += 1;
      }
    }
  }

  const handled = new Set<string>();
  const leafOrder = new Map<string, FormTemplateSeed[]>();
  for (const seed of fillableSeeds) {
    if (!seed.start) continue;
    const list = leafOrder.get(seed.topic) ?? [];
    list.push(seed);
    leafOrder.set(seed.topic, list);
  }
  for (const list of leafOrder.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title) || a.formKey.localeCompare(b.formKey));
  }

  for (const seed of fillableSeeds) {
    const existing = savedByKey.get(seed.formKey);
    const nextFormId = existing ? storedFormId(existing.formId, seed.formId, seed.formKey) : seed.formId;
    const currentFolderOk =
      existing?.folderId != null && byId().has(existing.folderId) && !excludedFolderIds.has(existing.folderId) && (!home || insideFolder(byId(), existing.folderId, home.id) || (ready && placed.has(seed.formKey)));
    let folderId = currentFolderOk ? existing!.folderId : (topicFolder.get(seed.topic) ?? null);
    if (folderId == null && home && (!ready || !placed.has(seed.formKey))) {
      const created = await findOrCreateChild(db, home.id, seed.topic);
      remember(all, created);
      topicFolder.set(seed.topic, created.id);
      folderId = created.id;
    }
    if (!existing) {
      await db.insert(controlledFormTemplates).values({
        formKey: seed.formKey,
        formId: seed.formId,
        title: seed.title,
        subjectRoute: seed.subjectRoute,
        folderId,
      });
    } else {
      const assignFolder = !currentFolderOk && folderId != null && (!ready || !placed.has(seed.formKey));
      const fieldsDiffer = existing.formId !== nextFormId || existing.title !== seed.title || existing.subjectRoute !== seed.subjectRoute;
      if (fieldsDiffer || assignFolder) {
        await db
          .update(controlledFormTemplates)
          .set({
            formId: nextFormId,
            title: seed.title,
            subjectRoute: seed.subjectRoute,
            ...(assignFolder ? { folderId } : {}),
          })
          .where(eq(controlledFormTemplates.id, existing.id));
        if (assignFolder) existing.folderId = folderId;
      }
    }

    if (!seed.start) {
      if (folderId != null || ready) handled.add(seed.formKey);
      continue;
    }
    const startPath = blankTemplateStartPath(seed.formKey);
    const existingLeaf = all.find((folder) => folder.linkedPath === startPath);
    if (existingLeaf) {
      handled.add(seed.formKey);
      continue;
    }
    if (ready && placed.has(seed.formKey)) {
      handled.add(seed.formKey);
      continue;
    }
    const parentId = topicFolder.get(seed.topic) ?? folderId;
    if (parentId == null) continue;
    const index = leafOrder.get(seed.topic)?.findIndex((item) => item.formKey === seed.formKey) ?? 0;
    const siblings = all.filter((folder) => folder.parentId === parentId);
    const sortOrder = ready ? siblings.length : Math.max(0, index);
    const [created] = await db
      .insert(documentFolders)
      .values({
        name: blankTemplateLabel(nextFormId, seed.title),
        parentId,
        sortOrder,
        linkedPath: startPath,
      })
      .returning();
    if (!created) continue;
    const twins = await db.select().from(documentFolders).where(eq(documentFolders.linkedPath, startPath));
    const keeper = [...twins].sort((a, b) => a.id - b.id)[0];
    if (keeper && keeper.id !== created.id) {
      await db.delete(documentFolders).where(eq(documentFolders.id, created.id));
      remember(all, keeper);
    } else {
      remember(all, created);
    }
    handled.add(seed.formKey);
  }

  await placeExcludedTemplates(db, all, iso.id, home?.id, savedByKey);

  const placedNext = [...handled].filter((key) => fillableSeeds.some((seed) => seed.formKey === key)).sort();
  const everyFillable = fillableSeeds.every((seed) => handled.has(seed.formKey));
  const markReady = everyFillable && home != null;
  const profileSame =
    ready === markReady &&
    profileRow?.profile?.blankFormsTemplatesFolderId === home?.id &&
    sameKeys(profileRow?.profile?.blankFormKeysPlaced, placedNext);
  if (profileRow && home && !profileSame) {
    const [fresh] = await db.select({ id: company.id, profile: company.profile }).from(company).where(eq(company.id, profileRow.id));
    if (fresh) {
      await db
        .update(company)
        .set({
          profile: {
            ...(fresh.profile ?? {}),
            blankFormsTemplatesReady: markReady,
            blankFormKeysPlaced: placedNext,
            blankFormsTemplatesFolderId: home.id,
          },
        })
        .where(eq(company.id, fresh.id));
    }
  }

  if (!ready && markReady && home) {
    const fromLabel = legacy ? folderLocationLabel(all, legacy.id) : "Blank Forms";
    const toLabel = folderLocationLabel(all, home.id);
    await recordAuditTrail(db, {
      entityType: FOLDER_AUDIT,
      entityId: home.id,
      action: "update",
      changes: {
        event: "moved",
        summary: `Moved the blank form templates from ${fromLabel} into ${toLabel}. Each blank opens a fresh copy. Saving a filled form does not change the blank.`,
        from: fromLabel,
        to: toLabel,
      },
      performedBy,
    });
  } else if (ready && home) {
    for (const seed of fillableSeeds) {
      if (!seed.start || placed.has(seed.formKey) || !handled.has(seed.formKey)) continue;
      const leaf = all.find((folder) => folder.linkedPath === blankTemplateStartPath(seed.formKey));
      if (!leaf) continue;
      await recordAuditTrail(db, {
        entityType: FOLDER_AUDIT,
        entityId: leaf.id,
        action: "create",
        changes: {
          event: "moved",
          summary: `Added the blank template "${leaf.name}" under ${folderLocationLabel(all, leaf.parentId)}.`,
          name: leaf.name,
          to: folderLocationLabel(all, leaf.parentId),
        },
        performedBy,
      });
    }
  }

  const keep = new Set<number>();
  if (home) keep.add(home.id);
  for (const id of topicFolder.values()) keep.add(id);
  for (const folder of all) {
    if (folder.linkedPath?.startsWith("/blank-forms/start/")) keep.add(folder.id);
  }
  const legacyDrawer = all.find((folder) => folder.parentId === iso.id && folder.name === PREVIOUS_BLANK_FORMS_FOLDER);
  if (legacyDrawer) keep.add(legacyDrawer.id);
  await pruneEmptyDescendants(db, iso.id, keep);
}

/** Living lists stay on the older drawer. They are never given a Blank Forms Templates shortcut. */
async function placeExcludedTemplates(
  db: Db,
  all: FolderRow[],
  isoId: number,
  homeId: number | undefined,
  savedByKey: Map<string, typeof controlledFormTemplates.$inferSelect>,
) {
  const byId = () => new Map(all.map((folder) => [folder.id, folder]));
  for (const seed of FORM_TEMPLATES) {
    if (!keptOutOfBlankFormsTemplates(seed)) continue;
    const existing = savedByKey.get(seed.formKey);
    const nextFormId = existing ? storedFormId(existing.formId, seed.formId, seed.formKey) : seed.formId;
    const current = existing?.folderId != null ? byId().get(existing.folderId) : undefined;
    const insideHome = current != null && homeId != null && insideFolder(byId(), current.id, homeId);
    let folderId = current && !insideHome ? current.id : null;
    if (folderId == null) {
      let legacy = all.find((folder) => folder.parentId === isoId && folder.name === PREVIOUS_BLANK_FORMS_FOLDER);
      if (!legacy) {
        legacy = await findOrCreateChild(db, isoId, PREVIOUS_BLANK_FORMS_FOLDER);
        remember(all, legacy);
      }
      let topic = all.find((folder) => folder.parentId === legacy.id && folder.name === seed.topic);
      if (!topic) {
        topic = await findOrCreateChild(db, legacy.id, seed.topic);
        remember(all, topic);
      }
      folderId = topic.id;
    }
    if (!existing) {
      const [created] = await db
        .insert(controlledFormTemplates)
        .values({ formKey: seed.formKey, formId: seed.formId, title: seed.title, subjectRoute: seed.subjectRoute, folderId })
        .returning();
      if (created) savedByKey.set(seed.formKey, created);
      continue;
    }
    const fieldsDiffer = existing.formId !== nextFormId || existing.title !== seed.title || existing.subjectRoute !== seed.subjectRoute;
    if (fieldsDiffer || existing.folderId !== folderId) {
      await db
        .update(controlledFormTemplates)
        .set({ formId: nextFormId, title: seed.title, subjectRoute: seed.subjectRoute, folderId })
        .where(eq(controlledFormTemplates.id, existing.id));
      existing.folderId = folderId;
    }
  }
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
    if (!/^\d/.test(folder.name) && folder.name !== PREVIOUS_NUMBERED_BLANK_FOLDER) continue;
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
  fileNamePattern: string;
  start: FormStart | null;
}

export async function listFormTemplates(db: Db, performedBy?: number): Promise<{ fileNamePattern: string; templates: FormTemplateView[] }> {
  await ensureFormTemplates(db, performedBy);
  const templates = await db.select().from(controlledFormTemplates);
  const folders = await db.select().from(documentFolders);
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const liveKeys = new Set(FORM_TEMPLATES.map((seed) => seed.formKey));
  const starts = new Map(FORM_TEMPLATES.map((seed) => [seed.formKey, seed.start]));
  const patterns = new Map(FORM_TEMPLATES.map((seed) => [seed.formKey, fileNamePatternFor(seed)]));

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
      .filter((template) => liveKeys.has(template.formKey))
      .map((template) => ({
        id: template.id,
        formKey: template.formKey,
        formId: template.formId,
        title: template.title,
        subjectRoute: template.subjectRoute,
        folderId: template.folderId,
        isoPath: pathOf(template.folderId),
        fileNamePattern: patterns.get(template.formKey) ?? FILE_NAME_PATTERN,
        start: starts.get(template.formKey) ?? null,
      }))
      .sort((a, b) => a.formId.localeCompare(b.formId)),
  };
}

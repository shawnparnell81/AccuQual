import { sql } from "drizzle-orm";
import { company } from "../../drizzle/schema/company.js";
import type { Db } from "../../lib/requestDb.js";
import { folderIdentityKey } from "./duplicateFolders.js";

/** `parent identity` + record separator + `folder identity`. A root folder uses an empty parent. NUL is not used: Postgres jsonb rejects it. */
export function documentFolderTombstone(parentName: string | null, name: string): string {
  const parentKey = parentName == null || parentName === "" ? "" : folderIdentityKey(parentName);
  return `${parentKey}\u001e${folderIdentityKey(name)}`;
}

export async function deletedDocumentFolderTokens(db: Db): Promise<Set<string>> {
  const [row] = await db.select({ profile: company.profile }).from(company).limit(1);
  return new Set(row?.profile?.deletedDocumentFolders ?? []);
}

export function isTombstoned(tokens: ReadonlySet<string>, parentName: string | null, name: string): boolean {
  return tokens.has(documentFolderTombstone(parentName, name));
}

export async function rememberDeletedDocumentFolder(db: Db, parentName: string | null, name: string): Promise<void> {
  const encoded = JSON.stringify([documentFolderTombstone(parentName, name)]);
  await db.execute(sql`
    UPDATE company
    SET profile = jsonb_set(
      COALESCE(profile, '{}'::jsonb),
      '{deletedDocumentFolders}',
      CASE
        WHEN COALESCE(profile->'deletedDocumentFolders', '[]'::jsonb) @> ${encoded}::jsonb
        THEN COALESCE(profile->'deletedDocumentFolders', '[]'::jsonb)
        ELSE COALESCE(profile->'deletedDocumentFolders', '[]'::jsonb) || ${encoded}::jsonb
      END
    )
  `);
}

export async function rememberDeletedFormFolders(db: Db, formKeys: readonly string[]): Promise<void> {
  if (formKeys.length === 0) return;
  const encoded = JSON.stringify([...new Set(formKeys)]);
  await db.execute(sql`
    UPDATE company
    SET profile = jsonb_set(
      COALESCE(profile, '{}'::jsonb),
      '{deletedFormFolderKeys}',
      (
        SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
        FROM (
          SELECT value FROM jsonb_array_elements(COALESCE(profile->'deletedFormFolderKeys', '[]'::jsonb))
          UNION
          SELECT value FROM jsonb_array_elements(${encoded}::jsonb)
        ) AS incoming
      )
    )
  `);
}

export async function rememberFormFolderName(db: Db, formKeys: readonly string[], name: string): Promise<void> {
  const patch: Record<string, string> = {};
  for (const key of formKeys) patch[key] = name;
  const encoded = JSON.stringify(patch);
  await db.execute(sql`
    UPDATE company
    SET profile = jsonb_set(
      COALESCE(profile, '{}'::jsonb),
      '{formFolderDisplayNames}',
      COALESCE(profile->'formFolderDisplayNames', '{}'::jsonb) || ${encoded}::jsonb
    )
  `);
}

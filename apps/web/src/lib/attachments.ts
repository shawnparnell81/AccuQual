import { apiClient } from "../api/client";

/** Attaches one file to a record through the generic attachments endpoint (the same one every "Evidence / Attachments" panel uses). */
export async function uploadAttachmentFor(entityType: string, entityId: number, file: File, options?: { inlineImage?: boolean }) {
  const body = new FormData();
  body.append("file", file);
  body.append("entityType", entityType);
  body.append("entityId", String(entityId));
  if (options?.inlineImage) body.append("inlineImage", "1");
  return (await apiClient.post("/attachments", body, { headers: { "Content-Type": "multipart/form-data" } })).data;
}

/** Uploads files chosen before a record existed. One failure never stops the rest; the names that didn't make it are returned. */
export async function uploadPendingAttachments(entityType: string, entityId: number, files: File[]): Promise<{ uploaded: number; failed: string[] }> {
  let uploaded = 0;
  const failed: string[] = [];
  for (const file of files) {
    try {
      await uploadAttachmentFor(entityType, entityId, file);
      uploaded += 1;
    } catch {
      failed.push(file.name);
    }
  }
  return { uploaded, failed };
}

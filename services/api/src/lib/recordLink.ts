/** Absolute link to a record, for an email body. `path` is an in-app route such as `/documents/12`. */
export function appRecordUrl(frontendUrl: string, path: string): string {
  const base = frontendUrl.replace(/\/$/, "");
  const route = path.startsWith("/") ? path : `/${path}`;
  return `${base}${route}`;
}

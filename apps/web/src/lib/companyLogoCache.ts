/** Last company logo prepared for `<img>` and for print. No network and no React. */
let cached: { url: string; src: string | null } | null = null;

/** `undefined` means this URL has not been resolved yet. `null` means there is no logo. */
export function cachedCompanyLogoFor(url: string): string | null | undefined {
  if (!cached || cached.url !== url) return undefined;
  return cached.src;
}

export function currentCompanyLogo(): string | null {
  return cached?.src ?? null;
}

export function rememberCompanyLogo(url: string, src: string | null): void {
  cached = { url, src };
}

/**
 * Company-wide Digital Twin on/off. Unset means off, so existing companies
 * (including DMA, which has no production line) stay hidden until someone
 * sets profile.digitalTwinEnabled. The web app mirrors this exact rule in
 * apps/web/src/lib/digitalTwinFlag.ts — separate deployables, no shared package.
 */
export function digitalTwinEnabled(profile: { digitalTwinEnabled?: boolean } | null | undefined): boolean {
  return profile?.digitalTwinEnabled === true;
}

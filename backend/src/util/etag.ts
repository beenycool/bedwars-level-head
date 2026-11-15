/**
 * Builds the public-facing ETag for a player response.
 * Shared by the private and public player routes so both produce identical validators.
 */
export function computeResponseEtag(baseEtag: string | null, nicked: boolean): string | null {
  if (!baseEtag) return null;
  return `"player-v2-${nicked ? 'nicked' : 'valid'}-${baseEtag.replace(/^"|"$/g, '')}"`;
}

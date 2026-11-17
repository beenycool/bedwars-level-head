export function computeResponseEtag(baseEtag: string | null, nicked: boolean): string | null {
  if (!baseEtag) return null;
  return `"player-v2-${nicked ? 'nicked' : 'valid'}-${baseEtag.replace(/^"|"$/g, '')}"`;
}

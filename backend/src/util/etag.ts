export function computeResponseEtag(baseEtag: string | null, nicked: boolean): string | null {
  if (!baseEtag) return null;
  // Upstream sends weak tags like `W/"abc"`; unwrap to the bare opaque value so
  // wrapping it in our own quotes cannot produce internal quote characters.
  const inner = baseEtag
    .replace(/^W\//, '')
    .replace(/^"+|"+$/g, '')
    .replace(/"/g, '');
  return `"player-v2-${nicked ? 'nicked' : 'valid'}-${inner}"`;
}

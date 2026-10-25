export function viewerIsHost(search = location.search): boolean {
  return !new URLSearchParams(search).has('player');
}

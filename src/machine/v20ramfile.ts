export function v20LoadRamFile(dest: Uint8Array, data: Uint8Array | null | undefined): void {
  const size = dest.length;
  const len = data?.length ?? 0;
  if (!data || len === 0) { dest.fill(0); return; }
  if (len > size) {
    const count = Math.min(len - size, size);
    dest.set(data.subarray(len - size, len - size + count));
    return;
  }
  dest.set(data);
}

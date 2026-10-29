import type * as THREE from 'three';

export function isCoinSlot(lp: { acceptor?: unknown; coinInput?: number }): boolean {
  return lp.acceptor !== undefined || lp.coinInput !== undefined;
}

export class CoinEntry {
  readonly nodes: THREE.Object3D[] = [];

  constructor(root: THREE.Object3D, names: readonly string[], id: string) {
    const missing: string[] = [];
    for (const name of names) {
      const node = root.getObjectByName(name);
      if (!node) { missing.push(name); continue; }
      node.userData.coin = true;
      this.nodes.push(node);
    }
    if (missing.length) console.warn(`[arcade] cabinet ${id}: the manifest names coin parts the model does not have: ${missing.join(', ')}`);
  }

  static hit(o: THREE.Object3D | null): boolean {
    for (let x = o; x; x = x.parent) if (x.userData.coin) return true;
    return false;
  }
}

export function reveal(root: THREE.Object3D, used: readonly THREE.Object3D[]): void {
  const keep = new Set<THREE.Object3D>();
  for (const u of used) for (let x: THREE.Object3D | null = u; x && x !== root; x = x.parent) keep.add(x);
  const usedSet = new Set(used);
  for (const x of keep) {
    if (x.visible) continue;
    x.visible = true;
    if (usedSet.has(x)) continue;
    for (const c of x.children) if (!keep.has(c)) c.visible = false;
  }
}

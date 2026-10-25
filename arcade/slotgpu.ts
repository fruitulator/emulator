import * as THREE from 'three';
import { disposeShell, type CabinetShell } from './cabinets';

export function retireShell(holder: THREE.Object3D, shell: CabinetShell, glass: THREE.Texture | null): void {
  holder.remove(shell.group);
  disposeShell(shell, glass);
}

export function releaseStand(holder: THREE.Object3D, shell: CabinetShell | null, glass: THREE.Texture): void {
  if (shell) retireShell(holder, shell, glass);
  holder.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    for (const x of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) x.dispose();
  });
  glass.dispose();
}

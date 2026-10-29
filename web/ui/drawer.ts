import { backRow, choreograph, menuRow } from './rows';
import { scrollFromOpen } from './scrollsettle';

export const PANEL_SHOW = 'menu-panel-show';

export interface DrawerElements {
  menu: HTMLElement;
  backdrop: HTMLElement;
  content: HTMLElement;
  sub: HTMLElement;
  fly: HTMLElement;
}

export class MenuDrawer {
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  private flyRow: HTMLElement | null = null;
  private flyTimer = 0;
  private flyBy: 'hover' | 'click' = 'hover';

  constructor(readonly el: DrawerElements) {
    el.backdrop.addEventListener('click', () => this.close());
    for (const e of [el.menu, el.fly]) {
      e.addEventListener('pointerleave', (ev) => {
        const to = ev.relatedTarget as Element | null;
        if (to?.closest?.('.dd-float')) return;
        if (ev.pointerType === 'mouse') this.scheduleFlyoutClose();
      });
      e.addEventListener('pointerenter', () => window.clearTimeout(this.flyTimer));
    }
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !el.fly.classList.contains('open')) return;
      this.closeFlyout();
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
    document.addEventListener('pointerdown', (e) => {
      if (!el.fly.classList.contains('open')) return;
      const path = e.composedPath();
      if (path.includes(el.fly) || path.includes(el.menu)) return;
      if (path.some((n) => n instanceof Element && n.classList.contains('dd-float'))) return;
      this.closeFlyout();
    }, true);
  }

  get isOpen(): boolean {
    return !this.el.menu.hidden;
  }

  open(): void {
    const { menu, backdrop } = this.el;
    menu.hidden = false;
    backdrop.hidden = false;
    this.onOpen?.();
    void menu.offsetWidth;
    menu.classList.add('open');
    backdrop.classList.add('open');
  }

  close(): void {
    const { menu, backdrop } = this.el;
    if (menu.hidden) return;
    this.onClose?.();
    menu.classList.remove('open');
    backdrop.classList.remove('open');
    this.closeFlyout();
    window.setTimeout(() => {
      if (!menu.classList.contains('open')) {
        menu.hidden = true;
        backdrop.hidden = true;
        this.closeSubmenu();
      }
    }, 300);
  }

  openSubmenu(title: string, panel: HTMLElement, onBack: () => void = () => this.closeSubmenu()): void {
    const back = backRow(title, onBack);
    const { menu, content, sub } = this.el;
    panel.dispatchEvent(new Event(PANEL_SHOW));
    sub.replaceChildren(back, panel);
    choreograph(sub);
    sub.scrollTop = 0;
    menu.classList.add('sub-open');
    content.inert = true;
  }

  closeSubmenu(): void {
    this.el.menu.classList.remove('sub-open');
    this.el.content.inert = false;
  }

  flyoutMode(): boolean {
    return matchMedia('(hover: hover) and (pointer: fine)').matches && window.innerWidth >= 900;
  }

  openFlyout(title: string, panel: HTMLElement, row: HTMLElement): void {
    const fly = this.el.fly;
    window.clearTimeout(this.flyTimer);
    if (this.flyRow === row && fly.classList.contains('open')) return;
    const drill = fly.classList.contains('open') && fly.contains(row);
    const top = drill ? fly.getBoundingClientRect().top : 0;
    if (!drill) {
      this.flyRow?.classList.remove('active');
      this.flyRow = row;
      row.classList.add('active');
    }
    const h = document.createElement('div');
    h.className = 'nb-panel__title menu-fly-title';
    h.textContent = title;
    panel.dispatchEvent(new Event(PANEL_SHOW));
    fly.replaceChildren(h, panel);
    choreograph(fly);
    fly.scrollTop = 0;
    fly.classList.add('open');
    scrollFromOpen(fly);
    if (drill) this.keepFlyout(top);
    else this.placeFlyout(row);
  }

  private keepFlyout(top: number): void {
    const fly = this.el.fly;
    const h = fly.offsetHeight;
    fly.style.top = `${Math.round(Math.max(16, Math.min(top, innerHeight - 16 - h)))}px`;
  }

  private placeFlyout(row: HTMLElement): void {
    const fly = this.el.fly;
    const m = this.el.menu.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    fly.style.left = `${Math.round(m.right + 12)}px`;
    const h = fly.offsetHeight;
    fly.style.top = `${Math.round(Math.max(16, Math.min(r.top - 18, innerHeight - 16 - h)))}px`;
  }

  closeFlyout(): void {
    window.clearTimeout(this.flyTimer);
    this.el.fly.classList.remove('open');
    this.flyRow?.classList.remove('active');
    this.flyRow = null;
  }

  private scheduleFlyoutClose(): void {
    window.clearTimeout(this.flyTimer);
    this.flyTimer = window.setTimeout(() => this.closeFlyout(), 260);
  }

  navRow(label: string, icon: string, panel: HTMLElement): HTMLButtonElement {
    const b = menuRow(label, icon, () => {
      if (!this.flyoutMode()) { this.openSubmenu(label, panel); return; }
      if (this.flyRow === b && this.el.fly.classList.contains('open') && this.flyBy === 'click') {
        this.closeFlyout();
        return;
      }
      this.openFlyout(label, panel, b);
      this.flyBy = 'click';
    }, true);
    if (!panel.childElementCount) {
      b.disabled = true;
      b.setAttribute('aria-disabled', 'true');
      return b;
    }
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && this.flyoutMode() && this.flyRow !== b) {
        this.openFlyout(label, panel, b);
        this.flyBy = 'hover';
      }
    });
    return b;
  }
}

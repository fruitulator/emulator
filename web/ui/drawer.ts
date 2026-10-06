import { backRow, choreograph, menuRow } from './rows';

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
  private flyRow: HTMLButtonElement | null = null;
  private flyTimer = 0;

  constructor(readonly el: DrawerElements) {
    el.backdrop.addEventListener('click', () => this.close());
    for (const e of [el.menu, el.fly]) {
      e.addEventListener('pointerleave', (ev) => {
        if (ev.pointerType === 'mouse') this.scheduleFlyoutClose();
      });
      e.addEventListener('pointerenter', () => window.clearTimeout(this.flyTimer));
    }
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

  openSubmenu(title: string, panel: HTMLElement): void {
    const back = backRow(title, () => this.closeSubmenu());
    const { menu, content, sub } = this.el;
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

  openFlyout(title: string, panel: HTMLElement, row: HTMLButtonElement): void {
    const fly = this.el.fly;
    window.clearTimeout(this.flyTimer);
    if (this.flyRow === row && fly.classList.contains('open')) return;
    this.flyRow?.classList.remove('active');
    this.flyRow = row;
    row.classList.add('active');
    const h = document.createElement('div');
    h.className = 'menu-fly-title';
    h.textContent = title;
    fly.replaceChildren(h, panel);
    choreograph(fly);
    fly.scrollTop = 0;
    fly.classList.add('open');
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
      if (this.flyoutMode()) this.openFlyout(label, panel, b);
      else this.openSubmenu(label, panel);
    }, true);
    if (!panel.childElementCount) {
      b.disabled = true;
      b.setAttribute('aria-disabled', 'true');
      return b;
    }
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && this.flyoutMode()) this.openFlyout(label, panel, b);
    });
    return b;
  }
}

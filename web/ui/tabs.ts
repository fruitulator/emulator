export interface TabBar<T extends string> {
  el: HTMLElement;
  readonly value: T;
}

export function tabBar<T extends string>(o: {
  label: string; tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void;
}): TabBar<T> {
  const el = document.createElement('div');
  el.className = 'ui-tabs';
  el.setAttribute('role', 'tablist');
  el.setAttribute('aria-label', o.label);
  let value = o.value;
  const buttons = o.tabs.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ui-tab';
    b.setAttribute('role', 'tab');
    b.textContent = t.label;
    b.dataset.id = t.id;
    return b;
  });
  const show = (): void => {
    for (const b of buttons) {
      const on = b.dataset.id === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  const pick = (id: T): void => {
    if (id === value) return;
    value = id;
    show();
    o.onChange(id);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => pick(o.tabs[i].id));
    b.addEventListener('keydown', (e) => {
      const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
      if (to < 0 || to >= buttons.length) return;
      e.preventDefault();
      buttons[to].focus();
      pick(o.tabs[to].id);
    });
  });
  el.append(...buttons);
  show();
  return { el, get value() { return value; } };
}

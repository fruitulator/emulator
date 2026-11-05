export function segSwitch(o: {
  label: string;
  options: readonly { value: string; text: string }[];
  value: string;
  onChange: (value: string) => void;
}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'seg-switch';
  root.setAttribute('role', 'radiogroup');
  root.setAttribute('aria-label', o.label);
  let value = o.value;
  const paint = (): void => {
    buttons.forEach((b, i) => {
      const on = o.options[i].value === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  };
  const choose = (next: string): void => {
    if (next === value) return;
    value = next;
    paint();
    o.onChange(next);
  };
  const buttons = o.options.map((opt, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-switch-opt';
    b.setAttribute('role', 'radio');
    b.textContent = opt.text;
    b.addEventListener('click', () => choose(opt.value));
    b.addEventListener('keydown', (ev) => {
      const by = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
      if (!by) return;
      ev.preventDefault();
      const to = (i + by + o.options.length) % o.options.length;
      choose(o.options[to].value);
      buttons[to].focus();
    });
    return b;
  });
  root.append(...buttons);
  paint();
  return root;
}

export interface TextField {
  el: HTMLDivElement;
  input: HTMLInputElement;
  error(text: string): void;
}

export function textField(o: {
  label: string; type?: string; value?: string; placeholder?: string; maxLength?: number;
  autocomplete?: string; spellcheck?: boolean;
}): TextField {
  const el = document.createElement('div');
  el.className = 'nb-field';
  const cap = document.createElement('span');
  cap.className = 'nb-field__label';
  cap.textContent = o.label;
  const input = document.createElement('input');
  input.className = 'nb-input';
  input.type = o.type ?? 'text';
  if (o.value !== undefined) input.value = o.value;
  if (o.placeholder) input.placeholder = o.placeholder;
  if (o.maxLength) input.maxLength = o.maxLength;
  if (o.autocomplete) input.setAttribute('autocomplete', o.autocomplete);
  input.spellcheck = o.spellcheck ?? false;
  input.setAttribute('aria-label', o.label);
  const err = document.createElement('span');
  err.className = 'nb-field__error';
  err.setAttribute('role', 'alert');
  err.hidden = true;
  el.append(cap, input, err);
  return {
    el, input,
    error: (t) => {
      err.textContent = t;
      err.hidden = !t;
      input.setAttribute('aria-invalid', t ? 'true' : 'false');
    },
  };
}

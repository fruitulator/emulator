export function richInto<T extends HTMLElement>(n: T, text: string): T {
  for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
    const bold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
    const code = part.startsWith('`') && part.endsWith('`') && part.length > 2;
    if (bold || code) {
      const m = document.createElement(bold ? 'strong' : 'code');
      m.textContent = bold ? part.slice(2, -2) : part.slice(1, -1);
      n.append(m);
    } else if (part) n.append(document.createTextNode(part));
  }
  return n;
}

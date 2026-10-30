
export const MENU_ICONS = {
  coins: '<ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5V12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6.5"/><path d="M4.5 12v5.5c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V12"/>',
  switches: '<rect x="2.5" y="7" width="19" height="10" rx="5"/><circle cx="16.5" cy="12" r="3"/>',
  dil: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>',
  options: '<path d="M3 7.5h7.5M18.5 7.5H21M3 16.5h4.5M15 16.5h6"/><circle cx="13.5" cy="7.5" r="2.5"/><circle cx="10" cy="16.5" r="2.5"/>',
  reboot: '<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  activity: '<path d="M2.5 12h4.2l3-7.5 4.6 15 3-7.5h4.2"/>',
  matrix: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
  sound: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 9.5h.01M10 9.5h.01M13.5 9.5h.01M17.5 9.5h.01M6.5 12.75h.01M10 12.75h.01M13.5 12.75h.01M17.5 12.75h.01M8.5 15.5h7"/>',
  back: '<path d="M20 12H4"/><path d="M11 19l-7-7 7-7"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
  chevRight: '<path d="m9 6 6 6-6 6"/>',
  chevLeft: '<path d="m15 6-6 6 6 6"/>',
};

export const UI_ICONS = {
  ...MENU_ICONS,
  reset: '<path d="M3 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L3 10"/>',
  tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-4.6-4-8.7-9-8.7z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  cross: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  no: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 13h9l1-13"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>',
  cabinet: '<rect x="6" y="2.5" width="12" height="19" rx="1.5"/><rect x="8.5" y="5" width="7" height="7" rx="0.5"/><path d="M8.5 15.5h7"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  wall: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9.3h18M3 14.7h18M9 4v5.3M15 4v5.3M6 9.3v5.4M12 9.3v5.4M18 9.3v5.4M9 14.7V20M15 14.7V20"/>',
  floor: '<path d="M3 19l4-10h10l4 10z"/><path d="M5 14h14M10 9l-1.5 10M14 9l1.5 10"/>',
  neon: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  hourglass: '<path d="M6.5 3h11M6.5 21h11"/><path d="M8 3v3.2a4 4 0 0 0 1.5 3.1L12 12l2.5-2.7A4 4 0 0 0 16 6.2V3"/><path d="M8 21v-3.2a4 4 0 0 1 1.5-3.1L12 12l2.5 2.7a4 4 0 0 1 1.5 3.1V21"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  archive: '<path d="M20.5 8v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V8"/><rect x="2" y="3.5" width="20" height="4.5" rx="1"/><path d="M10 12h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  globeAdd: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'
    + '<circle cx="19.2" cy="19.2" r="4.8" style="fill: var(--nb-violet-hi); stroke: none"/>'
    + '<path d="M19.2 16.8v4.8M16.8 19.2h4.8" style="stroke: #fff; stroke-width: 1.8"/>',
  tag: '<g style="stroke-width: 1.8"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></g>',
  warn: '<path d="M10.3 4.2 2.6 17.8A2 2 0 0 0 4.3 20.8h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.2h.01"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  key: '<circle cx="7.5" cy="15.5" r="4"/><path d="M10.4 12.6 20 3"/><path d="M16.5 6.5l3 3"/><path d="M14 9l2 2"/>',
  library: '<path d="M4 4v16M8 8v12M12 6v14M16 6l4 14"/>',
  stack: '<path d="M12 3.5 3 8l9 4.5L21 8z"/><path d="M3 12.5 12 17l9-4.5"/><path d="M3 16.5 12 21l9-4.5"/>',
  star: '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>',
  trophy: '<path d="M8 3.5h8v5a4 4 0 0 1-8 0z"/><path d="M8 5.5H4.5a3 3 0 0 0 3.6 3.9M16 5.5h3.5a3 3 0 0 1-3.6 3.9"/><path d="M12 12.5v4M8.5 20.5h7M9.5 20.5l.5-4h4l.5 4"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  backspace: '<path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17.5 9.5l-5 5M12.5 9.5l5 5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16.5v-5"/><path d="M12 7.8h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7"/><path d="M12 17h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  bug: '<path d="M8 2l1.9 1.9M16 2l-1.9 1.9"/><path d="M9 7.5V6a3 3 0 0 1 6 0v1.5"/><rect x="7" y="7.5" width="10" height="12" rx="5"/><path d="M12 7.5v12"/><path d="M3 13h4M17 13h4M4 7.5l3 1.5M20 7.5l-3 1.5M4 18.5l3-1.5M20 18.5l-3-1.5"/>',
};

export const BRAND_MARKS = {
  github: {
    box: '0 0 16 16',
    path: 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z',
  },
} as const;

export function brandMark(mark: { box: string; path: string }, size = 18): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', mark.box);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', mark.path);
  svg.append(path);
  return svg;
}

export function rowIcon(paths: string, cls = 'row-icon', size = 18): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = cls;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = paths;
  wrap.append(svg);
  return wrap;
}

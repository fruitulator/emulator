
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
  cross: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
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
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  key: '<circle cx="7.5" cy="15.5" r="4"/><path d="M10.4 12.6 20 3"/><path d="M16.5 6.5l3 3"/><path d="M14 9l2 2"/>',
  library: '<path d="M4 4v16M8 8v12M12 6v14M16 6l4 14"/>',
  star: '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
};

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

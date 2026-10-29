const NB_AVATAR_PALETTE = [
  ['#ff9a9a', '#c92a45'], ['#8fe8b4', '#178a52'], ['#ffdc7a', '#d98a00'], ['#9fd0ff', '#2563d6'],
  ['#d3b0ff', '#6d33e0'], ['#ffc09a', '#d4561f'], ['#8eeeea', '#138c99'], ['#ffa8dc', '#c4247f'],
];

export function nebulaAvatarColours(name) {
  let h = 0;
  for (const ch of String(name).toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return NB_AVATAR_PALETTE[h % NB_AVATAR_PALETTE.length];
}

export function nebulaAvatar({ name, photoUrl, size = 40 }) {
  const el = document.createElement('span');
  el.className = 'nb-avatar';
  el.style.setProperty('--s', `${size}px`);
  if (photoUrl) {
    const img = document.createElement('img');
    img.src = photoUrl; img.alt = name; img.width = img.height = size;
    el.append(img);
  } else {
    const [a, b] = nebulaAvatarColours(name);
    el.style.setProperty('--a', a); el.style.setProperty('--b', b);
    el.setAttribute('role', 'img'); el.setAttribute('aria-label', name);
    el.textContent = (name.trim()[0] || '?').toUpperCase();
  }
  return el;
}

export function nebulaOpenSpot(size = 64) {
  const el = document.createElement('span');
  el.className = 'nb-avatar nb-avatar--open';
  el.style.setProperty('--s', `${size}px`);
  el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'Open spot');
  return el;
}

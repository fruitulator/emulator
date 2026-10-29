import { closeSheet, escapeCloses, showSheet } from './ui/sheet';
import { actionButton } from './ui/list';
import { str } from './i18n';

export interface VersionRow {
  title: string;
  tags: string[];
  status: string;
  resume: boolean;
  preferred: boolean;
  thumb(): Promise<string | null>;
  revoke?: boolean;
}

export function openVersionPicker(o: {
  title: string;
  maker: string;
  rows: VersionRow[];
  onPlay(i: number): void;
  onUngroup?(): void;
}): void {
  const urls: string[] = [];
  const list = document.createElement('div');
  list.className = 'vp-rows';

  o.rows.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = r.preferred ? 'vp-row vp-row--preferred' : 'vp-row nb-glass';

    const img = document.createElement('img');
    img.className = 'vp-thumb';
    img.alt = '';
    void r.thumb().then((u) => {
      if (!u) return;
      if (r.revoke) urls.push(u);
      img.src = u;
    });

    const mid = document.createElement('div');
    mid.className = 'vp-mid';
    const name = document.createElement('div');
    name.className = 'vp-title';
    name.textContent = r.title;
    const tags = document.createElement('div');
    tags.className = 'chips vp-tags';
    if (r.preferred) {
      const p = document.createElement('span');
      p.className = 'nb-chip nb-chip--gold';
      p.textContent = str('versionpicker.last_played');
      tags.append(p);
    }
    r.tags.forEach((t, k) => {
      const c = document.createElement('span');
      c.className = k === 0 ? 'nb-chip' : 'nb-chip nb-chip--grey';
      c.textContent = t;
      tags.append(c);
    });
    const meta = document.createElement('div');
    meta.className = 'nb-meta';
    meta.textContent = r.status;
    mid.append(name, ...(tags.childElementCount ? [tags] : []), meta);

    const go = actionButton(r.resume ? str('orbit.resume') : str('orbit.play'),
      r.preferred ? 'primary' : 'secondary', () => { closeSheet(); o.onPlay(i); });
    go.classList.add('nb-btn--sm');
    const acts = document.createElement('div');
    acts.className = 'vp-acts';
    acts.append(go);
    row.append(img, mid, acts);
    list.append(row);
  });

  const foot = document.createElement('div');
  foot.className = 'vp-foot';
  const count = document.createElement('span');
  count.className = 'nb-meta';
  count.textContent = str('versionpicker.n_versions_grouped', { n: o.rows.length });
  foot.append(count);
  if (o.onUngroup) {
    const ungroup = o.onUngroup;
    const b = actionButton(str('versionpicker.ungroup'), 'secondary', () => { closeSheet(); ungroup(); });
    b.classList.add('nb-btn--sm');
    foot.append(b);
  }

  const returnTo = (document.activeElement as HTMLElement | null) ?? document.body;
  showSheet(o.title, [list], returnTo, {
    foot: [foot],
    sub: `${o.maker} · ${str('gamelist.n_versions', { n: o.rows.length })}`,
    closeButton: true,
    variant: 'wide',
  });
  escapeCloses(() => { for (const u of urls) URL.revokeObjectURL(u); });
}

import { listGames, getThumb, type GameMeta } from './store';
import { libraryMaker, UNKNOWN_MAKER } from './maker';
import { parseTitle } from './title';
import { cleanTitle, titleKey } from './versionkey';
import { hashThumbBytes, hamming } from './thumbhash';
import { ART_DISTANCE, groupVersions, type VersionGroup, type VersionItem } from './versiongroups';

const cardTitle = (g: GameMeta): string => g.title?.trim() || parseTitle(g.sourceName ?? g.name).title;

export async function run(): Promise<string> {
  const games = await listGames();
  const byId = new Map(games.map((g) => [g.hash, g]));
  const items: VersionItem[] = [];
  let noThumb = 0;
  console.log(`[versionGroups] ${games.length} games; hashing thumbnails...`);
  for (const g of games) {
    if (items.length && items.length % 50 === 0) console.log(`[versionGroups] ${items.length}/${games.length}`);
    let art: string | undefined;
    const bytes = g.hasThumb ? await getThumb(g.hash) : null;
    if (bytes) {
      try { art = await hashThumbBytes(bytes); } catch {  }
    }
    if (!art) noThumb++;
    items.push({ id: g.hash, maker: libraryMaker(g), title: cardTitle(g), art });
  }
  const item = new Map(items.map((it) => [it.id, it]));

  const strict = groupVersions(items, {}, { skipMaker: UNKNOWN_MAKER });
  const loose = groupVersions(items);
  const multi = (gs: VersionGroup[]) => gs.filter((g) => g.ids.length > 1);

  const L: string[] = [];
  const member = (id: string): string => {
    const g = byId.get(id)!;
    const raw = g.sourceName ?? g.name;
    return `    - ${cardTitle(g)}   [${g.system}]   from "${raw}"   key "${titleKey(cardTitle(g))}"`;
  };
  const link = (l: VersionGroup['links'][number]): string =>
    `      ${l.rule === 'art' ? `artwork, distance ${l.distance}` : l.rule}: ${cardTitle(byId.get(l.a)!)}  <->  ${cardTitle(byId.get(l.b)!)}`;
  const block = (g: VersionGroup): void => {
    const first = item.get(g.ids[0])!;
    L.push(`  ${cleanTitle(first.title)}  (${first.maker}, ${g.ids.length} versions)`);
    for (const id of g.ids) L.push(member(id));
    if (g.links.some((l) => l.rule === 'art')) for (const l of g.links) L.push(link(l));
  };

  const groups = multi(strict).sort((a, b) =>
    item.get(a.ids[0])!.maker.localeCompare(item.get(b.ids[0])!.maker)
    || cleanTitle(item.get(a.ids[0])!.title).localeCompare(cleanTitle(item.get(b.ids[0])!.title)));
  const grouped = groups.reduce((n, g) => n + g.ids.length, 0);

  L.push('Version groups proposed for this library');
  L.push(`Rules: same maker AND (same normalised title OR artwork dHash within ${ART_DISTANCE} bits).`);
  L.push(`Games with no known maker ("${UNKNOWN_MAKER}") are left out of the main list; see section 4.`);
  L.push('');
  L.push(`${games.length} games -> ${groups.length} groups holding ${grouped} games, ${games.length - grouped} single cards.`);
  L.push(`${noThumb} games have no thumbnail, so only the name rule can group them.`);
  L.push('');

  L.push('1. ALL GROUPS (by maker, then title)');
  L.push('   Each member: card title, board, the name it was imported as, its name key.');
  L.push('   Where artwork took part, the links that formed the group follow.');
  let maker = '';
  for (const g of groups) {
    const m = item.get(g.ids[0])!.maker;
    if (m !== maker) { L.push(''); L.push(`== ${m} ==`); maker = m; }
    block(g);
  }
  L.push('');

  L.push('2. LINKED BY ARTWORK ONLY (the likeliest false matches: the names differ)');
  const artOnly = groups.flatMap((g) => g.links).filter((l) =>
    l.rule === 'art' && titleKey(item.get(l.a)!.title) !== titleKey(item.get(l.b)!.title));
  if (!artOnly.length) L.push('   none');
  for (const l of artOnly) L.push(link(l));
  L.push('');

  L.push('3. GROUPS OF MORE THAN 6 VERSIONS (chains are where a wrong link spreads)');
  const big = groups.filter((g) => g.ids.length > 6);
  if (!big.length) L.push('   none');
  for (const g of big) block(g);
  L.push('');

  L.push(`4. GAMES WITH NO KNOWN MAKER: the groups they would form if "${UNKNOWN_MAKER}" counted as one maker`);
  const unknown = multi(loose).filter((g) => item.get(g.ids[0])!.maker === UNKNOWN_MAKER);
  if (!unknown.length) L.push('   none');
  for (const g of unknown) block(g);
  L.push('');

  L.push(`5. NEAR MISSES: same maker, different names, artwork distance ${ART_DISTANCE + 1}-10 (NOT grouped; shows how close the threshold sits)`);
  const near: [number, string][] = [];
  for (let x = 0; x < items.length; x++) {
    for (let y = x + 1; y < items.length; y++) {
      const p = items[x], q = items[y];
      if (!p.art || !q.art || p.maker !== q.maker || p.maker === UNKNOWN_MAKER) continue;
      if (titleKey(p.title) === titleKey(q.title)) continue;
      const d = hamming(p.art, q.art);
      if (d > ART_DISTANCE && d <= 10) near.push([d, `      distance ${d}: ${p.title}  <->  ${q.title}  (${p.maker})`]);
    }
  }
  L.push(...(near.length ? near.sort((a, b) => a[0] - b[0]).map((n) => n[1]) : ['   none']));
  L.push('');

  const text = L.join('\n');
  console.log(text);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = 'version-groups.txt';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  return `${games.length} games, ${groups.length} groups; saved version-groups.txt`;
}

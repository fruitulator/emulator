const PRECACHE = /*PRECACHE*/ { build: 'dev', files: [] };
const SUMS = PRECACHE.sums || {};
const CACHE = `fruitulator-${PRECACHE.build}`;
const SHELL = '/index.html';
const ARCADE_SHELL = '/arcade/index.html';
const SHELL_PAGES = [[SHELL, '/'], [ARCADE_SHELL, '/arcade/']];
const SUMS_KEY = '/__sw/sums.json';

function shellFor(url) {
  return url.pathname === '/arcade' || url.pathname.startsWith('/arcade/') ? ARCADE_SHELL : SHELL;
}

async function tell(msg) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of all) c.postMessage({ type: 'precache-progress', build: PRECACHE.build, ...msg });
}

function storable(res) {
  return res.redirected
    ? res.blob().then((b) => new Response(b, { status: res.status, statusText: res.statusText, headers: res.headers }))
    : Promise.resolve(res);
}

function isPage(res) {
  return (res.headers.get('content-type') ?? '').includes('text/html');
}

async function previousBuilds() {
  const others = [];
  for (const name of await caches.keys()) {
    if (name === CACHE) continue;
    const c = await caches.open(name);
    const rec = await c.match(SUMS_KEY);
    let sums = {};
    try { if (rec) sums = await rec.json(); } catch {  }
    others.push({ c, sums });
  }
  return async (key) => {
    let old;
    if (key.startsWith('/assets/')) old = await caches.match(key);
    else if (SUMS[key]) {
      for (const o of others) {
        if (o.sums[key] !== SUMS[key]) continue;
        old = await o.c.match(key);
        if (old) break;
      }
    }
    return old && !isPage(old) ? old : undefined;
  };
}

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.put(SUMS_KEY, new Response(JSON.stringify(SUMS), { headers: { 'content-type': 'application/json' } }));
  const jobs = [
    ...SHELL_PAGES.map(([key, page]) => ({ key, from: page, page: true })),
    ...PRECACHE.files.map((f) => ({ key: f, from: f })),
  ];
  const kept = await previousBuilds();
  const downloads = [];
  for (const job of jobs) {
    if (await cache.match(job.key)) continue;
    const old = job.page ? undefined : await kept(job.key);
    if (old) await cache.put(job.key, old);
    else downloads.push(job);
  }
  const total = downloads.length;
  let done = 0;
  let failed = 0;
  await tell({ done, total });
  const one = async ({ key, from, page }) => {
    try {
      const res = await fetch(from, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${from}: ${res.status}`);
      if (!page && isPage(res)) throw new Error(`${from}: a page, not the file`);
      await cache.put(key, await storable(res));
      done++;
    } catch (e) {
      failed++;
      console.warn('[sw] not saved for offline', key, e && e.message);
    }
    await tell({ done, total, failed });
  };
  const queue = downloads.slice();
  const lane = async () => { for (let j = queue.shift(); j; j = queue.shift()) await one(j); };
  await Promise.all([lane(), lane(), lane(), lane()]);
  if (failed) throw new Error(`${failed} of ${jobs.length} files not saved for offline`);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'build') {
    if (event.ports && event.ports[0]) event.ports[0].postMessage({ build: PRECACHE.build });
    return;
  }
  if (event.data && event.data.type === 'skip-waiting') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  const urls = event.data && event.data.type === 'cache-assets' ? event.data.urls : null;
  if (!Array.isArray(urls)) return;
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(
    urls.map((u) => fetch(u).then((res) => (res.ok && !isPage(res) ? c.put(u, res) : undefined)).catch(() => undefined)),
  )));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/arcade-server' || url.pathname.startsWith('/arcade-server/')) return;

  if (req.mode === 'navigate') {
    const shell = shellFor(url);
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (!PRECACHE.files.length) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(shell, copy));
          }
          return res;
        })
        .catch(() => caches.open(CACHE).then((c) => c.match(shell)).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then((c) => c.match(req, { ignoreVary: true })).then((hit) => (hit && !isPage(hit) ? hit : fetch(req).then((res) => {
      if (res.ok && res.type === 'basic' && !isPage(res)) {
        const copy = res.clone();
        void caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }))),
  );
});

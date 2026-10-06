const PRECACHE = /*PRECACHE*/ { build: 'dev', files: [] };
const CACHE = `fruitulator-${PRECACHE.build}`;
const SHELL = '/index.html';
const ARCADE_SHELL = '/arcade/index.html';
const SHELL_PAGES = [[SHELL, '/'], [ARCADE_SHELL, '/arcade/']];

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

async function precache() {
  const cache = await caches.open(CACHE);
  const jobs = [
    ...SHELL_PAGES.map(([key, page]) => ({ key, from: page })),
    ...PRECACHE.files.map((f) => ({ key: f, from: f })),
  ];
  const total = jobs.length;
  let done = 0;
  let failed = 0;
  await tell({ done, total });
  const one = async ({ key, from }) => {
    try {
      if (!(await cache.match(key))) {
        const old = key.startsWith('/assets/') ? await caches.match(key) : undefined;
        if (old) await cache.put(key, old);
        else {
          const res = await fetch(from, { cache: 'no-cache' });
          if (!res.ok) throw new Error(`${from}: ${res.status}`);
          await cache.put(key, await storable(res));
        }
      }
      done++;
    } catch (e) {
      failed++;
      console.warn('[sw] not saved for offline', key, e && e.message);
    }
    await tell({ done, total, failed });
  };
  const queue = jobs.slice();
  const lane = async () => { for (let j = queue.shift(); j; j = queue.shift()) await one(j); };
  await Promise.all([lane(), lane(), lane(), lane()]);
  if (failed) throw new Error(`${failed} of ${total} files not saved for offline`);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const urls = event.data && event.data.type === 'cache-assets' ? event.data.urls : null;
  if (!Array.isArray(urls)) return;
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(
    urls.map((u) => c.add(u).catch(() => undefined)),
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
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put(shell, copy));
          return res;
        })
        .catch(() => caches.match(shell).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreVary: true }).then((hit) => hit ?? fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        void caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});

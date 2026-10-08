import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { precachePlugin } from './tools/vite-precache.mjs';
import { boardStamps } from './tools/importgraph.mjs';

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
})();

const root = dirname(fileURLToPath(import.meta.url));
const hasArcade = existsSync(join(root, 'arcade', 'index.html'));
const escapeGlob = (p: string) => p.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
const unwatched = [
  'trove',
  '.claude',
  'bin',
  'dist',
  'wasm/build',
  'test/vectors',
].flatMap((d) => {
  const abs = escapeGlob(`${root}/${d}`);
  return [abs, `${abs}/**`];
});

const ARCADE_PROXY = '/arcade-server';

const STRAY_UPGRADE_MS = 3000;

function closeStrayUpgrades(): Plugin {
  return {
    name: 'close-stray-upgrades',
    configureServer(server) {
      server.httpServer?.on('upgrade', (req, socket) => {
        if (req.url?.startsWith(`${ARCADE_PROXY}/`)) return;
        setTimeout(() => socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'), STRAY_UPGRADE_MS).unref();
      });
    },
  };
}

function arcadeSlash(): Plugin {
  const redirect = (req: { url?: string }, res: { statusCode: number; setHeader(k: string, v: string): void; end(): void }, next: () => void): void => {
    const url = req.url ?? '';
    const q = url.indexOf('?');
    if ((q < 0 ? url : url.slice(0, q)) !== '/arcade') return next();
    res.statusCode = 307;
    res.setHeader('location', `/arcade/${q < 0 ? '' : url.slice(q)}`);
    res.end();
  };
  return {
    name: 'arcade-slash',
    configureServer(server) { server.middlewares.use(redirect); },
    configurePreviewServer(server) { server.middlewares.use(redirect); },
  };
}

const lanCert = (() => {
  const dir = process.env.LAN_CERT_DIR || join(homedir(), '.fruitulator-lan');
  const cert = join(dir, 'cert.pem');
  const key = join(dir, 'key.pem');
  return existsSync(cert) && existsSync(key) ? { cert: readFileSync(cert), key: readFileSync(key) } : null;
})();

const arcadeServerPort = /^\d{1,5}$/.test(process.env.ARCADE_SERVER_PORT ?? '') ? process.env.ARCADE_SERVER_PORT : '8787';

export default defineConfig(({ mode }) => ({
  plugins: [arcadeSlash(), ...(mode === 'lan' ? [...(lanCert ? [] : [basicSsl()]), closeStrayUpgrades()] : []), precachePlugin()],
  optimizeDeps: { entries: ['index.html', ...(hasArcade ? ['arcade/index.html'] : [])] },
  build: {
    rolldownOptions: {
      input: {
        main: `${root}/index.html`,
        ...(hasArcade ? { arcade: `${root}/arcade/index.html` } : {}),
      },
    },
  },
  server: {
    watch: { ignored: unwatched },
    ...(mode === 'lan' ? { host: true, hmr: false, ws: false, ...(lanCert ? { https: lanCert } : {}) } : {}),
    proxy: {
      [ARCADE_PROXY]: {
        target: `http://127.0.0.1:${arcadeServerPort}`,
        changeOrigin: true,
        ws: true,
        rewrite: (p: string) => p.slice(ARCADE_PROXY.length),
      },
    },
  },
  define: {
    __BUILD_ID__: JSON.stringify(commit),
    __BOARD_STAMPS__: JSON.stringify(boardStamps(dirname(fileURLToPath(import.meta.url)))),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __HAS_ARCADE__: JSON.stringify(hasArcade && mode !== 'production' && mode !== 'live'),
  },
}));

// QA automatizada del build en Chrome y Edge (los dos navegadores que
// CrazyGames exige que funcionen).
//
//   npm run qa:browsers
//
// Para cada navegador y cada página del build:
//   - carga la página y espera a que el juego arranque de verdad
//   - recoge errores de consola y peticiones fallidas (404, etc.)
//   - detecta peticiones a dominios externos (el portal las mira de cerca, y
//     con AdBlock cualquier dependencia externa se cae)
//   - verifica que no haya scroll horizontal en la resolución más chica de QA
//   - en el partido, confirma que el canvas está DIBUJANDO (no negro), lo que
//     detecta un mapa roto o un crash silencioso del render
//
// Sin dependencias de npm: habla CDP por WebSocket, igual que record-preview.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'crazygames');
const PORT = 8398;

// La resolución de iframe más chica que usa la QA del portal.
const VIEW = { w: 821, h: 462 };

const PAGES = [
  'index.html', 'modo.html', 'jugar.html',
  'personajes.html', 'opciones.html', 'trofeos.html',
];
const MATCH = 'play.html?mode=1v1&bots=1';

const BROWSERS = [
  { name: 'Chrome', paths: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  ] },
  { name: 'Edge', paths: [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ] },
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png',
};

function serve() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      try {
        let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (rel.endsWith('/')) rel += 'index.html';
        const file = path.join(DIST, path.normalize(rel));
        if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
        const data = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
        res.end(data);
      } catch { res.writeHead(404).end('not found'); }
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const [m, fn] of this.handlers) if (m === msg.method) fn(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) { this.handlers.set(method, fn); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findBin(paths) {
  for (const p of paths) { try { await fs.access(p); return p; } catch {} }
  return null;
}

async function launch(bin, profileDir) {
  const proc = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    `--window-size=${VIEW.w},${VIEW.h}`,
    '--hide-scrollbars', '--mute-audio', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const browserWs = await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('no publicó endpoint CDP')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) { clearTimeout(to); resolve(m[0]); }
    });
  });

  const port = new URL(browserWs).port;
  let pageWs = null;
  for (let i = 0; i < 40 && !pageWs; i++) {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
    const pg = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (pg) pageWs = pg.webSocketDebuggerUrl; else await sleep(250);
  }
  if (!pageWs) throw new Error('no apareció target "page"');

  const ws = new WebSocket(pageWs);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('no conecté al CDP')), { once: true });
  });
  return { proc, cdp: new CDP(ws) };
}

async function visit(cdp, url, { isMatch = false } = {}) {
  const errors = [], failed = [], external = [];

  cdp.on('Runtime.exceptionThrown', (p) => {
    errors.push(p.exceptionDetails?.exception?.description
      ?? p.exceptionDetails?.text ?? 'excepción');
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') {
      errors.push(p.args.map((a) => a.value ?? a.description ?? '?').join(' '));
    }
  });
  cdp.on('Network.responseReceived', (p) => {
    const u = p.response.url;
    if (p.response.status >= 400) failed.push(`${p.response.status} ${u}`);
    // Sólo cuentan peticiones que salen A LA RED desde el juego. Los
    // esquemas internos del navegador (chrome-extension://, devtools://…)
    // son de extensiones instaladas en la máquina de QA, no del paquete:
    // contarlos daba falsos positivos que ocultaban los problemas reales.
    const internalScheme = /^(data:|blob:|chrome-extension:|chrome:|devtools:|about:|edge:)/.test(u);
    if (!u.startsWith(`http://localhost:${PORT}`) && !internalScheme) {
      external.push(u);
    }
  });

  await cdp.send('Page.navigate', { url });
  await sleep(isMatch ? 7000 : 1800);

  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const d = document.documentElement;
      const out = { overflowX: d.scrollWidth > d.clientWidth + 1,
                    scrollW: d.scrollWidth, clientW: d.clientWidth,
                    title: document.title, lang: d.lang };
      const c = document.querySelector('canvas');
      if (c && c.width) {
        // ¿El canvas dibujó algo? Un canvas de un solo color = render muerto.
        try {
          const g = c.getContext('2d');
          const px = g.getImageData(0, 0, c.width, c.height).data;
          const seen = new Set();
          for (let i = 0; i < px.length; i += 4 * 811) {
            seen.add((px[i] >> 4) + ',' + (px[i+1] >> 4) + ',' + (px[i+2] >> 4));
          }
          out.canvasColors = seen.size;
        } catch (e) { out.canvasColors = 'error: ' + e.message; }
      }
      return JSON.stringify(out);
    })()`,
    returnByValue: true,
  });

  return { info: JSON.parse(result.value), errors, failed, external };
}

async function main() {
  try { await fs.access(path.join(DIST, 'index.html')); }
  catch { throw new Error('Falta dist/crazygames — corré npm run build:crazygames'); }

  const srv = await serve();
  let problems = 0;

  try {
    for (const b of BROWSERS) {
      const bin = await findBin(b.paths);
      if (!bin) { console.log(`\n${b.name}: no instalado, se saltea`); continue; }
      console.log(`\n${b.name}`);

      const profile = path.join(ROOT, 'dist', '_qa_' + b.name.toLowerCase());
      const { proc, cdp } = await launch(bin, profile);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Network.enable');
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: "try { localStorage.setItem('escoba.lang.v1','en'); } catch (e) {}",
      });

      for (const p of [...PAGES, MATCH]) {
        const isMatch = p === MATCH;
        const r = await visit(cdp, `http://localhost:${PORT}/${p}`, { isMatch });
        const bad = [];
        if (r.errors.length) bad.push(`${r.errors.length} error(es) JS: ${r.errors[0].slice(0, 90)}`);
        if (r.failed.length) bad.push(`peticiones fallidas: ${r.failed[0]}`);
        if (r.external.length) bad.push(`petición externa: ${r.external[0]}`);
        if (r.info.overflowX) bad.push(`scroll horizontal ${r.info.scrollW}>${r.info.clientW}`);
        if (isMatch && typeof r.info.canvasColors === 'number' && r.info.canvasColors < 5) {
          bad.push(`canvas casi vacío (${r.info.canvasColors} colores) — ¿render roto?`);
        }
        problems += bad.length;
        const tag = bad.length ? '✘' : '✔';
        console.log(`  ${tag} ${p}${bad.length ? '\n      ' + bad.join('\n      ') : ''}`);
      }

      proc.kill();
      await sleep(400);
      await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    srv.close();
  }

  console.log(problems ? `\n${problems} problema(s) encontrados.` : '\nQA de navegadores OK.');
  process.exit(problems ? 1 : 0);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });

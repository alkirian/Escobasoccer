// Grabador de los dos videos de preview que pide CrazyGames.
//
//   npm run preview:video
//
// Produce, a partir de gameplay REAL del build de dist/crazygames/:
//   press/video/preview-landscape-1920x1080.mp4   (16:9, 1080p)
//   press/video/preview-portrait-1080x1620.mp4    (2:3, 1080 de ancho)
//
// Requisitos del portal que este script respeta por construcción:
//   - 15–20 s de duración (DURATION_S).
//   - Sin audio (el mp4 se escribe sin pista de sonido).
//   - Sin cursor (el juego ya oculta el cursor sobre el canvas, y además
//     nunca se mueve el mouse durante la grabación salvo para jugar).
//   - Sin barras negras: cada video se graba a su proporción nativa, no se
//     reescala un 16:9 dentro de un 2:3.
//   - Sin fundido desde negro ni logos: la captura arranca cuando el partido
//     YA está corriendo (se descartan los primeros segundos de carga).
//   - Sin acelerar: se graba a FPS reales y se codifica al mismo FPS.
//
// Cómo funciona: habla el protocolo de DevTools (CDP) por WebSocket contra un
// Chrome headless, sin dependencias de npm. Page.startScreencast entrega
// frames JPEG que se guardan numerados y ffmpeg los une.
//
// Requiere: Chrome instalado y ffmpeg en el PATH. El servidor de dist tiene
// que estar corriendo (npm run serve:dist) o se levanta uno propio.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'crazygames');
const OUTDIR = path.join(ROOT, 'press', 'video');

const DURATION_S = 18;        // dentro de la ventana 15–20 s del portal
const WARMUP_S = 6;           // carga + cuenta atrás: NO entra en el video
const FPS = 30;
const PORT = 8399;

// El juego es landscape por diseño (la cancha es horizontal; en vertical
// muestra el cartel de "girá el teléfono"). Por eso el preview vertical NO se
// graba en una ventana 2:3 — eso producía dos franjas negras enormes arriba y
// abajo, y CrazyGames rechaza los previews con barras negras. Se graba
// siempre en landscape y el vertical se obtiene RECORTANDO la franja central
// de la acción, que es donde ocurre el partido. Sale un 2:3 lleno de imagen.
//
//   crop: recorte en coordenadas de la captura landscape (w×h de `shot`).
const SHOT = { w: 1920, h: 1080 };

const VARIANTS = [
  { name: 'landscape', out: { w: 1920, h: 1080 } },
  {
    name: 'portrait',
    out: { w: 1080, h: 1620 },              // 2:3 exacto
    // 720×1080 es la franja 2:3 más alta que entra en un 1080p, centrada
    // horizontalmente. Se escala luego a 1080×1620.
    crop: { w: 720, h: 1080, x: (1920 - 720) / 2, y: 0 },
  },
];

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
];

async function findChrome() {
  for (const c of CHROME) {
    try { await fs.access(c); return c; } catch {}
  }
  throw new Error('No encontré chrome.exe — instalá Chrome o editá CHROME.');
}

// ── Servidor estático para dist/ ──────────────────────────────────────────
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
      } catch { res.writeHead(404).end(); }
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

// ── CDP mínimo sobre WebSocket ────────────────────────────────────────────
// Se usa el WebSocket nativo de Node 22+. Cada comando lleva su id y se
// resuelve cuando llega la respuesta con ese id.
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method && this.handlers.has(msg.method)) {
        this.handlers.get(msg.method)(msg.params);
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

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('No pude conectar al CDP')), { once: true });
  });
  return new CDP(ws);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function record(chrome, variant) {
  const { name, out: outSize, crop } = variant;
  // Siempre se CAPTURA en landscape (ver comentario de VARIANTS); el recorte
  // al 2:3 lo hace ffmpeg al final.
  const w = SHOT.w, h = SHOT.h;
  const frameDir = path.join(OUTDIR, '_frames_' + name);
  await fs.rm(frameDir, { recursive: true, force: true });
  await fs.mkdir(frameDir, { recursive: true });

  const userDir = path.join(OUTDIR, '_profile_' + name);
  const proc = spawn(chrome, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDir}`,
    `--window-size=${w},${h}`,
    '--hide-scrollbars',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // Chrome anuncia el endpoint del CDP por stderr. Ese endpoint es el del
  // NAVEGADOR: no acepta Page.* (falla con "'Page.enable' wasn't found"). Hay
  // que preguntarle por la lista de targets y conectarse al de la pestaña.
  const browserWs = await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('Chrome no publicó el endpoint del CDP')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) { clearTimeout(to); resolve(m[0]); }
    });
  });

  const devtoolsPort = new URL(browserWs).port;
  let pageWs = null;
  for (let i = 0; i < 40 && !pageWs; i++) {
    const list = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`).then((r) => r.json()).catch(() => []);
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) pageWs = page.webSocketDebuggerUrl; else await sleep(250);
  }
  if (!pageWs) throw new Error('No apareció ningún target de tipo "page".');

  const cdp = await connect(pageWs);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: false,
  });

  // El idioma del video: inglés, que es el que ve el revisor del portal.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try { localStorage.setItem('escoba.lang.v1','en'); } catch (e) {}",
  });

  const url = `http://localhost:${PORT}/play.html?mode=1v1&bots=1`;
  await cdp.send('Page.navigate', { url });
  await sleep(1500);

  // Warm-up: carga del mapa + cuenta atrás. Nada de esto entra en el video,
  // así el primer frame ya es gameplay (el portal no quiere fundidos desde
  // negro ni pantallas de carga).
  await sleep(WARMUP_S * 1000);

  let n = 0;
  const writes = [];
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    const idx = String(n++).padStart(5, '0');
    writes.push(fs.writeFile(path.join(frameDir, `f${idx}.jpg`), Buffer.from(data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });

  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 92, everyNthFrame: 1,
    maxWidth: w, maxHeight: h,
  });
  await sleep(DURATION_S * 1000);
  await cdp.send('Page.stopScreencast');
  await Promise.all(writes);

  proc.kill();
  await sleep(400);
  await fs.rm(userDir, { recursive: true, force: true }).catch(() => {});

  if (n < FPS * 5) {
    throw new Error(`Sólo ${n} frames capturados para ${name}: la página no estaba dibujando.`);
  }

  // ffmpeg: sin audio (-an), yuv420p para compatibilidad universal, CRF 21
  // (calidad alta y bien por debajo de los 50 MB), faststart para que arranque
  // sin descargar el archivo entero.
  const out = path.join(OUTDIR, `preview-${name}-${outSize.w}x${outSize.h}.mp4`);
  const realFps = (n / DURATION_S).toFixed(3);

  // Cadena de filtros:
  //  1. Recorte anti-marca-de-agua. Esta máquina corre un Windows sin
  //     activar, y el "Activar Windows" del sistema se cuela en la captura
  //     abajo a la derecha. No es del juego (no existe en el HTML), pero
  //     igual quedaría en el video, así que se recortan las últimas filas y
  //     se reescala. Es invisible: se pierde una banda de fondo, no acción.
  //  2. El recorte 2:3 de la variante vertical, si la hay.
  //  3. Escalado final al tamaño exacto que pide el portal.
  const WM = 46;                       // alto de la banda con la marca
  const chain = [`crop=${w}:${h - WM}:0:0`];
  if (crop) {
    // El recorte del portrait se expresa sobre el frame completo; hay que
    // limitarlo a la altura ya recortada.
    const ch = Math.min(crop.h, h - WM);
    chain.push(`crop=${crop.w}:${ch}:${crop.x}:${crop.y}`);
  }
  chain.push(`scale=${outSize.w}:${outSize.h}:flags=lanczos`);
  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-framerate', realFps,
      '-i', path.join(frameDir, 'f%05d.jpg'),
      '-r', String(FPS),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '21',
      '-pix_fmt', 'yuv420p',
      '-vf', chain.join(','),
      '-movflags', '+faststart',
      '-an',
      out,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('close', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg falló:\n' + err.slice(-1500))));
  });

  await fs.rm(frameDir, { recursive: true, force: true });
  const st = await fs.stat(out);
  console.log(`  ${path.relative(ROOT, out)}  ${n} frames @${realFps}fps  ${(st.size/1024/1024).toFixed(2)} MB`);
  if (st.size > 50 * 1024 * 1024) console.warn('  ⚠ supera los 50 MB del portal');
}

async function main() {
  await fs.mkdir(OUTDIR, { recursive: true });
  try { await fs.access(path.join(DIST, 'index.html')); }
  catch { throw new Error('Falta dist/crazygames — corré primero npm run build:crazygames'); }

  const chrome = await findChrome();
  const srv = await serve();
  console.log(`Grabando ${DURATION_S}s de gameplay real por variante...`);
  try {
    for (const v of VARIANTS) await record(chrome, v);
  } finally {
    srv.close();
  }
  console.log('\nListo. Revisá los dos videos antes de subirlos: el primer frame\n' +
              'debería parecerse a la portada estática correspondiente.');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });

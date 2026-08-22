// Build de CrazyGames (Basic Launch).
//
//   npm run build:crazygames
//
// Produce dist/crazygames/ con SOLO los archivos que el juego necesita, y el
// ZIP listo para subir al Developer Portal (con index.html en la raíz del
// ZIP, sin carpeta envolvente).
//
// Cómo decide qué entra: camina el grafo real de dependencias desde las seis
// páginas del jugador (script src, link stylesheet/icon, imports estáticos y
// dinámicos de los módulos). Todo lo que no es alcanzable —editores, escenas
// de dev, tools/, sw.js, manifest, docs— queda fuera sin listas negras que
// mantener. Los únicos agregados a mano son los assets referenciados por
// string en runtime (la imagen del mapa, que vive en CFG.arena.src).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist', 'crazygames');
const ZIP_NAME = 'BroomballBlitz-CrazyGames.zip';

// Páginas que ve el jugador. editor.html / veditor.html / menu.html y las
// escenas de dev NO están acá — por eso no viajan.
// modo.html se sumó cuando el flujo pasó a ser menú → elegir modo → elegir
// personaje: el botón JUGAR de index.html apunta ahí, así que sin esta
// entrada el ZIP del portal quedaba con un link roto a la primera página
// que toca cualquier jugador que aprieta JUGAR.
const ENTRIES = [
  'index.html', 'modo.html', 'play.html', 'jugar.html',
  'personajes.html', 'opciones.html', 'trofeos.html',
];

// Referenciados por string en runtime (el walker no los puede ver):
const RUNTIME_ASSETS = [
  'mapa.webp',        // CFG.arena.src
];

// build_config que viaja en el paquete del portal. Reemplaza al del repo.
const PORTAL_CONFIG = `// Configuración de BUILD — GENERADA por scripts/build-crazygames.mjs.
// Esta copia es la del paquete de CrazyGames; el repo queda en standalone.
export const BUILD_CONFIG = {
  platform: 'crazygames',
  portalMode: true,
  pwa: false,
  externalLinks: false,
  // Basic Launch va sin SDK: no se carga ningún script externo. Para Full
  // Launch se cambia a true (la implementación ya vive en
  // src/platform/crazygames.js) y se re-corre la QA.
  sdk: false,
  debug: false,
};
`;

const seen = new Set();      // rutas relativas a public/, con / como separador
const missing = [];

const norm = (p) => p.split(path.sep).join('/');

async function exists(rel) {
  try { await fs.access(path.join(PUB, rel)); return true; } catch { return false; }
}

// Resuelve una referencia encontrada en `fromRel` y la encola.
async function enqueue(ref, fromRel) {
  if (!ref || /^(https?:|data:|#|mailto:)/.test(ref)) return;
  ref = decodeURIComponent(ref.split('#')[0].split('?')[0]);
  if (!ref) return;
  const baseDir = path.posix.dirname(norm(fromRel));
  const rel = path.posix.normalize(
    ref.startsWith('/') ? ref.slice(1) : path.posix.join(baseDir, ref));
  if (seen.has(rel)) return;
  if (!(await exists(rel))) { missing.push(`${fromRel} → ${ref}`); return; }
  seen.add(rel);
  if (/\.(js|mjs|html)$/.test(rel)) await scan(rel);
}

async function scan(rel) {
  const src = await fs.readFile(path.join(PUB, rel), 'utf8');
  const refs = [];
  if (rel.endsWith('.html')) {
    for (const m of src.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) refs.push(m[1]);
    for (const m of src.matchAll(/<link[^>]+href=["']([^"']+)["']/g)) {
      // El <link rel="manifest"> se elimina del HTML al copiar (paso 2):
      // no debe arrastrar el manifest al paquete.
      if (/rel=["']manifest["']/.test(m[0])) continue;
      refs.push(m[1]);
    }
    for (const m of src.matchAll(/<img[^>]+src=["']([^"']+)["']/g)) refs.push(m[1]);
  }
  // Imports de módulos: estáticos y dinámicos (valen también para los
  // <script type="module"> inline de los HTML).
  for (const m of src.matchAll(/import\s+[^'"]*?from\s*["']([^"']+)["']/g)) refs.push(m[1]);
  for (const m of src.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) refs.push(m[1]);
  for (const r of refs) await enqueue(r, rel);
}

// Vacía el directorio de salida sin borrarlo. En Windows el Explorador, un
// antivirus o un servidor estático apuntando a dist/ mantienen el *directorio*
// abierto y `fs.rm(recursive)` falla con EBUSY aunque los archivos sí se
// puedan reemplazar. Borrando el contenido y dejando la carpeta en pie, el
// build funciona igual con dist/ abierta en una ventana.
async function cleanDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    try {
      await fs.rm(p, { recursive: true, force: true });
    } catch (e) {
      if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e;
      // Un archivo tomado por otro proceso se sobrescribe igual más abajo;
      // solo avisamos para que un sobrante viejo no pase inadvertido.
      console.warn(`  ⚠ no se pudo borrar ${norm(path.relative(ROOT, p))} (${e.code}); se sobrescribe`);
    }
  }
}

async function main() {
  // 1) Grafo de dependencias desde las entradas
  for (const e of ENTRIES) {
    if (!(await exists(e))) throw new Error(`Falta la entrada ${e}`);
    seen.add(e);
    await scan(e);
  }
  for (const a of RUNTIME_ASSETS) {
    if (!(await exists(a))) throw new Error(`Falta el asset ${a}`);
    seen.add(a);
  }
  if (missing.length) {
    console.error('Referencias rotas:\n  ' + missing.join('\n  '));
    process.exit(1);
  }

  // El manifest y el sw NUNCA deben colarse en el build del portal.
  for (const banned of ['sw.js', 'manifest.webmanifest']) {
    if (seen.has(banned)) {
      console.error(`El grafo arrastró ${banned} — revisar quién lo referencia.`);
      process.exit(1);
    }
  }

  // 2) Copiar limpio
  await cleanDir(OUT);
  for (const rel of [...seen].sort()) {
    const dst = path.join(OUT, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    if (rel.endsWith('.html')) {
      // El build del portal no depende del manifest: fuera el <link>. Y
      // ningún enlace saliente viaja en el paquete (cross-promotion): las
      // anclas externas se quitan del HTML, no solo se ocultan en runtime.
      // (\r?\n: los HTML del repo son CRLF y `.` no matchea \r.)
      let html = await fs.readFile(path.join(PUB, rel), 'utf8');
      html = html.replace(/^.*<link[^>]+rel=["']manifest["'][^>]*>.*\r?\n/gm, '');
      html = html.replace(/<a[^>]+href=["']https?:\/\/[^"']+["'][^>]*>[\s\S]*?<\/a>/g, '');
      // Los editores (veditor/editor) NO viajan en el paquete, así que un
      // <a> que los apunte es un 404 esperando a que alguien haga clic. Hoy
      // esos enlaces se borran en runtime (externalLinks:false), pero eso
      // depende de que el módulo cargue: si fallara, el revisor del portal
      // encuentra una página de error. Se quitan también del HTML, que es
      // donde el problema no puede volver.
      html = html.replace(/<a[^>]+href=["'](?:v?editor)\.html["'][^>]*>[\s\S]*?<\/a>/g, '');
      await fs.writeFile(dst, html);
    } else {
      await fs.copyFile(path.join(PUB, rel), dst);
    }
  }

  // 3) La config del portal pisa a la standalone
  await fs.writeFile(path.join(OUT, 'src', 'build_config.js'), PORTAL_CONFIG);

  // 4) ZIP con index.html en la raíz. Se escribe el formato ZIP a mano
  //    (cabeceras locales + directorio central + EOCD, DEFLATE de zlib):
  //    el `tar` que trae Windows es GNU tar y NO sabe crear zips — con
  //    `-a -cf x.zip` producía un tar disfrazado que el portal rechazaría
  //    (descubierto porque zipfile de Python lo declaró "not a zip file").
  //    Cero dependencias y separadores '/' garantizados.
  const zipTmp = path.join(ROOT, 'dist', ZIP_NAME);
  await fs.rm(zipTmp, { force: true });
  await writeZip(zipTmp, OUT, [...seen].sort());
  // El "resultado final" pedido vive en dist/crazygames/; se copia también a
  // dist/ porque el validador y el pipeline lo esperan ahí.
  await fs.copyFile(zipTmp, path.join(OUT, ZIP_NAME));

  // 5) Resumen
  let total = 0, files = 0, biggest = ['', 0];
  for (const rel of seen) {
    const st = await fs.stat(path.join(OUT, rel));
    total += st.size; files++;
    if (st.size > biggest[1]) biggest = [rel, st.size];
  }
  const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
  console.log(`\nBuild CrazyGames listo:
  dist/crazygames/           ${files} archivos, ${mb(total)}
  archivo más pesado         ${biggest[0]} (${mb(biggest[1])})
  dist/${ZIP_NAME}
  dist/crazygames/${ZIP_NAME}`);
}

// ── Escritor ZIP mínimo ────────────────────────────────────────────────────
// Formato clásico (sin zip64: sobra hasta 4 GB). Cada entrada va con método
// DEFLATE, nombre con '/', y sin carpeta envolvente: `entries` son rutas
// relativas a `baseDir` y quedan tal cual en la raíz del ZIP.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

async function writeZip(zipPath, baseDir, entries) {
  const { time, date } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const rel of entries) {
    const name = Buffer.from(rel, 'utf8');       // ya viene con '/'
    const data = await fs.readFile(path.join(baseDir, rel));
    const crc = crc32(data);
    const comp = deflateRawSync(data, { level: 9 });
    // Si deflate no achica (el jpeg), STORE deja el zip más liviano.
    const useDeflate = comp.length < data.length;
    const body = useDeflate ? comp : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);                  // versión mínima
    local.writeUInt16LE(0x0800, 6);              // flags: nombres UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);                  // sin extra
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);                // hecho por
    central.writeUInt16LE(20, 6);                // requiere
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra/comment/disco/attrs internos: 0
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + body.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  await fs.writeFile(zipPath, Buffer.concat([...locals, cd, eocd]));
}

main().catch((e) => { console.error(e); process.exit(1); });

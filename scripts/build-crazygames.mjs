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
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist', 'crazygames');
const ZIP_NAME = 'EscobaVoladora-CrazyGames.zip';

// Páginas que ve el jugador. editor.html / veditor.html / menu.html y las
// escenas de dev NO están acá — por eso no viajan.
const ENTRIES = [
  'index.html', 'play.html', 'jugar.html',
  'personajes.html', 'opciones.html', 'trofeos.html',
];

// Referenciados por string en runtime (el walker no los puede ver):
const RUNTIME_ASSETS = [
  '1 mapa.jpeg',      // CFG.arena.src ('1%20mapa.jpeg', URL-encoded)
];

// build_config que viaja en el paquete del portal. Reemplaza al del repo.
const PORTAL_CONFIG = `// Configuración de BUILD — GENERADA por scripts/build-crazygames.mjs.
// Esta copia es la del paquete de CrazyGames; el repo queda en standalone.
export const BUILD_CONFIG = {
  platform: 'crazygames',
  portalMode: true,
  pwa: false,
  externalLinks: false,
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
  await fs.rm(OUT, { recursive: true, force: true });
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
      await fs.writeFile(dst, html);
    } else {
      await fs.copyFile(path.join(PUB, rel), dst);
    }
  }

  // 3) La config del portal pisa a la standalone
  await fs.writeFile(path.join(OUT, 'src', 'build_config.js'), PORTAL_CONFIG);

  // 4) ZIP con index.html en la raíz (bsdtar de Windows/macOS/Linux crea zip
  //    real con separadores '/'). Se listan las entradas de primer nivel para
  //    no envolver nada en carpetas ni arrastrar el propio zip.
  const top = await fs.readdir(OUT);
  const zipTmp = path.join(ROOT, 'dist', ZIP_NAME);
  await fs.rm(zipTmp, { force: true });
  // Rutas RELATIVAS a cwd: bsdtar interpreta "C:\..." como host remoto.
  execFileSync('tar',
    ['-a', '-cf', path.posix.join('dist', ZIP_NAME), '-C', 'dist/crazygames', ...top],
    { stdio: 'inherit', cwd: ROOT });
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

main().catch((e) => { console.error(e); process.exit(1); });

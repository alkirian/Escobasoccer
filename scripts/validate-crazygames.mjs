// Validador de release para CrazyGames (Basic Launch).
//
//   npm run validate:crazygames
//
// Revisa dist/crazygames/ contra los requisitos del portal. Si falla algo
// obligatorio: exit 1. Si pasa todo: "CRAZYGAMES BASIC LAUNCH READY".
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'crazygames');
const ZIP = 'EscobaVoladora-CrazyGames.zip';

const errors = [];
const warns = [];
const ok = [];

const norm = (p) => p.split(path.sep).join('/');

async function walk(dir, out = []) {
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

async function main() {
  // ── dist existe y tiene index.html en la raíz ─────────────────────────
  try { await fs.access(path.join(DIST, 'index.html')); ok.push('index.html en la raíz'); }
  catch { errors.push('No existe dist/crazygames/index.html — corré npm run build:crazygames'); }
  if (errors.length) return report();

  const files = (await walk(DIST)).map((p) => norm(path.relative(DIST, p)));
  const textFiles = files.filter((f) => /\.(html|js|mjs|css|json|webmanifest|svg)$/.test(f));

  // ── Archivos prohibidos ───────────────────────────────────────────────
  const forbidden = [
    [/^sw\.js$/, 'service worker'],
    [/^manifest\.webmanifest$/, 'manifest PWA'],
    [/^server\.js$/, 'server de desarrollo'],
    [/(^|\/)\.git(\/|$)/, '.git'],
    [/^(AUDITORIA|PROPUESTA|PLAN_|REVISION)/i, 'documentación interna'],
    [/^(dev|tools|capturas|scripts)\//, 'herramientas de desarrollo'],
    [/^(editor|veditor|menu)\.html$/, 'editores internos'],
    [/^package\.json$/, 'package.json'],
    [/^README/i, 'README'],
  ];
  let cleanTree = true;
  for (const f of files) {
    for (const [re, what] of forbidden) {
      if (re.test(f)) { errors.push(`Archivo prohibido en dist: ${f} (${what})`); cleanTree = false; }
    }
  }
  if (cleanTree) ok.push('sin server/sw/manifest/docs/herramientas');

  // ── Contenido: rutas absolutas, localhost, http inseguro ──────────────
  // Nota: sólo referencias REALES a recursos (src/href/import/url()/fetch) —
  // el texto libre y los comentarios no rompen un deploy.
  const refREs = [
    /<script[^>]+src=["']([^"']+)["']/g,
    /<link[^>]+href=["']([^"']+)["']/g,
    /<img[^>]+src=["']([^"']+)["']/g,
    /import\s+[^'"]*?from\s*["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /url\(\s*["']?([^"')]+)["']?\s*\)/g,
    /fetch\(\s*["']([^"']+)["']/g,
    /new Image\(\)[^;]*;\s*[^;]*\.src\s*=\s*["']([^"']+)["']/g,
  ];
  let refsOk = true, casingOk = true, absOk = true;

  // Índice real del árbol para verificar casing exacto por segmento
  const realNames = new Map();   // dir → Set(nombres reales)
  async function namesIn(dirRel) {
    if (!realNames.has(dirRel)) {
      try {
        realNames.set(dirRel, new Set(await fs.readdir(path.join(DIST, dirRel))));
      } catch { realNames.set(dirRel, new Set()); }
    }
    return realNames.get(dirRel);
  }

  for (const f of textFiles) {
    const src = await fs.readFile(path.join(DIST, f), 'utf8');

    if (/localhost|127\.0\.0\.1/.test(src)) {
      errors.push(`${f}: contiene "localhost"`); absOk = false;
    }
    if (/[A-Za-z]:\\/.test(src)) {
      errors.push(`${f}: contiene una ruta de Windows (C:\\...)`); absOk = false;
    }
    for (const m of src.matchAll(/["']http:\/\/(?!www\.w3\.org)[^"']+["']/g)) {
      errors.push(`${f}: recurso HTTP inseguro ${m[0]}`); absOk = false;
    }

    for (const re of refREs) {
      for (const m of src.matchAll(re)) {
        let ref = m[1];
        if (!ref || /^(https?:|data:|#|mailto:|blob:)/.test(ref)) continue;
        if (ref.startsWith('/')) {
          errors.push(`${f}: ruta absoluta "${ref}" — debe ser relativa`);
          absOk = false;
          continue;
        }
        ref = decodeURIComponent(ref.split('#')[0].split('?')[0]);
        if (!ref) continue;
        const rel = path.posix.normalize(path.posix.join(path.posix.dirname(f), ref));
        try {
          await fs.access(path.join(DIST, rel));
          // casing exacto, segmento a segmento (Windows no lo distingue,
          // el hosting del portal sí)
          let dir = '';
          for (const seg of rel.split('/')) {
            const names = await namesIn(dir);
            if (!names.has(seg)) {
              errors.push(`${f}: casing incorrecto en "${ref}" (segmento "${seg}")`);
              casingOk = false;
            }
            dir = dir ? dir + '/' + seg : seg;
          }
        } catch {
          errors.push(`${f}: referencia rota "${ref}"`);
          refsOk = false;
        }
      }
    }
  }
  if (absOk) ok.push('sin rutas absolutas, localhost ni HTTP inseguro');
  if (refsOk) ok.push('todos los recursos referenciados existen');
  if (casingOk) ok.push('casing exacto en todas las referencias');

  // ── Nada de fullscreen propio ni publicidad ───────────────────────────
  let fsOk = true, adsOk = true;
  for (const f of textFiles) {
    const src = await fs.readFile(path.join(DIST, f), 'utf8');
    if (/requestFullscreen|webkitRequestFullscreen|exitFullscreen/.test(src)) {
      errors.push(`${f}: implementa fullscreen propio`); fsOk = false;
    }
    if (/adsbygoogle|googlesyndication|unityads|adsense|doubleclick/i.test(src)) {
      errors.push(`${f}: referencia a proveedor de publicidad`); adsOk = false;
    }
  }
  if (fsOk) ok.push('sin fullscreen propio');
  if (adsOk) ok.push('sin publicidad externa');

  // ── Sin registro de service worker activo ─────────────────────────────
  // El código gated por BUILD_CONFIG.pwa puede viajar; lo que no puede pasar
  // es que la config del paquete lo habilite.
  const cfg = await fs.readFile(path.join(DIST, 'src', 'build_config.js'), 'utf8');
  if (!/platform:\s*'crazygames'/.test(cfg)) errors.push('build_config.js no es la variante crazygames');
  else ok.push("build_config: platform 'crazygames'");
  if (!/pwa:\s*false/.test(cfg)) errors.push('build_config.js tiene pwa: true');
  else ok.push('build_config: pwa false (SW no se registra)');
  if (!/externalLinks:\s*false/.test(cfg)) errors.push('build_config.js tiene externalLinks: true');
  else ok.push('build_config: sin enlaces externos');

  // ── Enlaces promocionales en HTML del build ───────────────────────────
  let linksOk = true;
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    const src = await fs.readFile(path.join(DIST, f), 'utf8');
    for (const m of src.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["']/g)) {
      errors.push(`${f}: enlace externo ${m[1]}`);
      linksOk = false;
    }
  }
  if (linksOk) ok.push('sin enlaces salientes en el HTML');

  // ── Inglés disponible ─────────────────────────────────────────────────
  try {
    const en = await fs.readFile(path.join(DIST, 'src', 'i18n', 'en.js'), 'utf8');
    const es = await fs.readFile(path.join(DIST, 'src', 'i18n', 'es.js'), 'utf8');
    const keys = (s) => new Set([...s.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
    const ken = keys(en), kes = keys(es);
    const missingEn = [...kes].filter((k) => !ken.has(k));
    if (missingEn.length) errors.push(`en.js sin las claves: ${missingEn.join(', ')}`);
    else ok.push(`inglés completo (${ken.size} claves, cubre las ${kes.size} de es)`);
  } catch { errors.push('falta src/i18n/en.js'); }

  // ── Tamaño y cantidad ─────────────────────────────────────────────────
  let total = 0;
  for (const f of files) total += (await fs.stat(path.join(DIST, f))).size;
  const zipSize = files.includes(ZIP) ? (await fs.stat(path.join(DIST, ZIP))).size : 0;
  const gameFiles = files.filter((f) => f !== ZIP);
  const gameBytes = total - zipSize;
  const mb = (n) => (n / 1024 / 1024).toFixed(2);
  if (gameBytes > 50 * 1024 * 1024) errors.push(`Build de ${mb(gameBytes)} MB — supera los 50 MB`);
  else ok.push(`tamaño ${mb(gameBytes)} MB (límite 50 MB)`);
  if (gameBytes > 20 * 1024 * 1024) warns.push(`Supera los 20 MB recomendados (${mb(gameBytes)} MB)`);
  else ok.push('dentro de los 20 MB recomendados');
  if (gameFiles.length > 1500) errors.push(`${gameFiles.length} archivos — supera los 1500`);
  else ok.push(`${gameFiles.length} archivos (límite 1500)`);

  // ── ZIP presente en ambas rutas pedidas, y que sea un ZIP DE VERDAD ──
  // (el tar de Windows es GNU tar: con `-a -cf x.zip` entregaba un tar
  // disfrazado que el portal rechazaría — de ahí esta firma.)
  let zipOk = true;
  for (const z of [path.join(ROOT, 'dist', ZIP), path.join(DIST, ZIP)]) {
    try {
      const fh = await fs.open(z, 'r');
      const buf = Buffer.alloc(4);
      await fh.read(buf, 0, 4, 0);
      await fh.close();
      if (buf.readUInt32LE(0) !== 0x04034b50) {
        errors.push(`${norm(path.relative(ROOT, z))} no es un ZIP (firma ${buf.toString('hex')})`);
        zipOk = false;
      }
    } catch { errors.push(`Falta ${norm(path.relative(ROOT, z))}`); zipOk = false; }
  }
  if (zipOk) ok.push('ZIP real (firma PK) en dist/ y dist/crazygames/');

  report();
}

function report() {
  for (const o of ok) console.log('  ✔ ' + o);
  for (const w of warns) console.log('  ⚠ ' + w);
  for (const e of errors) console.log('  ✘ ' + e);
  if (errors.length) {
    console.log(`\n${errors.length} error(es) — NO listo para publicar.`);
    process.exit(1);
  }
  console.log('\nCRAZYGAMES BASIC LAUNCH READY');
}

main().catch((e) => { console.error(e); process.exit(1); });
